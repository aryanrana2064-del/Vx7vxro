"""Lightweight file-based (SQLite) database with a Mongo/Motor-compatible async API.

Replaces MongoDB/Motor so VYRO VX7 runs 100% offline from a single local .db file.
Each collection is a table `col_<name>` (id TEXT PK, shopId TEXT, doc JSON). Queries filter
in Python over the JSON docs — perfectly fine for a single-shop offline POS dataset.
Supports the subset of the Mongo API used by server.py: find/find_one/insert_one/update_one/
update_many/delete_one/count_documents/distinct/find_one_and_update, with $set/$inc/$push and
$ne/$in/$gt/$gte/$lt/$lte operators, plus exclusion projections and single-field sort.
"""
import json
import os
import secrets
import sqlite3
import threading
from pathlib import Path


def _match(doc: dict, query: dict) -> bool:
    for key, cond in (query or {}).items():
        val = doc.get(key)
        if isinstance(cond, dict):
            for op, target in cond.items():
                if op == "$ne":
                    if val == target:
                        return False
                elif op == "$in":
                    if val not in target:
                        return False
                elif op == "$nin":
                    if val in target:
                        return False
                elif op == "$gte":
                    if val is None or val < target:
                        return False
                elif op == "$lte":
                    if val is None or val > target:
                        return False
                elif op == "$gt":
                    if val is None or val <= target:
                        return False
                elif op == "$lt":
                    if val is None or val >= target:
                        return False
                elif op == "$exists":
                    if (key in doc) != bool(target):
                        return False
                else:
                    return False
        else:
            if val != cond:
                return False
    return True


def _project(doc: dict, projection: dict | None) -> dict:
    if not projection:
        return doc
    excl = [k for k, v in projection.items() if v in (0, False)]
    if excl:
        for k in excl:
            doc.pop(k, None)
    return doc


class _Result:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, field, direction=1):
        if isinstance(field, (list, tuple)):
            for f, d in reversed(field):
                self._docs.sort(key=lambda x: (x.get(f) is None, x.get(f)), reverse=(d < 0))
        else:
            self._docs.sort(key=lambda x: (x.get(field) is None, x.get(field)), reverse=(direction < 0))
        return self

    async def to_list(self, length=None):
        return list(self._docs) if length is None else list(self._docs[:length])


class Collection:
    def __init__(self, conn, lock, name):
        self.conn = conn
        self.lock = lock
        self.table = f"col_{name}"
        with self.lock:
            self.conn.execute(
                f'CREATE TABLE IF NOT EXISTS "{self.table}" (id TEXT PRIMARY KEY, shopId TEXT, doc TEXT)'
            )
            self.conn.commit()

    def _all(self, query):
        query = query or {}
        with self.lock:
            if "shopId" in query and not isinstance(query["shopId"], dict):
                cur = self.conn.execute(f'SELECT doc FROM "{self.table}" WHERE shopId IS ?', (query["shopId"],))
            elif "id" in query and isinstance(query["id"], str):
                cur = self.conn.execute(f'SELECT doc FROM "{self.table}" WHERE id=?', (query["id"],))
            else:
                cur = self.conn.execute(f'SELECT doc FROM "{self.table}"')
            rows = cur.fetchall()
        docs = (json.loads(r[0]) for r in rows)
        return [d for d in docs if _match(d, query)]

    def _write(self, doc):
        with self.lock:
            self.conn.execute(
                f'INSERT OR REPLACE INTO "{self.table}" (id, shopId, doc) VALUES (?,?,?)',
                (doc["id"], doc.get("shopId"), json.dumps(doc, default=str)),
            )
            self.conn.commit()

    @staticmethod
    def _apply(doc, update):
        for op, fields in update.items():
            if op == "$set":
                doc.update(fields)
            elif op == "$inc":
                for k, v in fields.items():
                    doc[k] = (doc.get(k) or 0) + v
            elif op == "$push":
                for k, v in fields.items():
                    doc.setdefault(k, []).append(v)
            elif op == "$unset":
                for k in fields:
                    doc.pop(k, None)
        return doc

    @staticmethod
    def _seed(query):
        doc = {}
        for k, v in (query or {}).items():
            if not isinstance(v, dict):
                doc[k] = v
        return doc

    async def find_one(self, query=None, projection=None):
        docs = self._all(query)
        return _project(docs[0], projection) if docs else None

    def find(self, query=None, projection=None):
        return Cursor([_project(d, projection) for d in self._all(query)])

    async def distinct(self, field, query=None):
        out = []
        for d in self._all(query):
            v = d.get(field)
            if v not in out:
                out.append(v)
        return out

    async def insert_one(self, doc):
        doc = dict(doc)
        if "id" not in doc:
            doc["id"] = secrets.token_hex(12)
        self._write(doc)
        return _Result(inserted_id=doc["id"])

    async def insert_many(self, docs):
        ids = []
        for d in docs:
            r = await self.insert_one(d)
            ids.append(r.inserted_id)
        return _Result(inserted_ids=ids)

    async def update_one(self, query, update, upsert=False):
        docs = self._all(query)
        if docs:
            self._write(self._apply(docs[0], update))
            return _Result(matched_count=1, modified_count=1, upserted_id=None)
        if upsert:
            doc = self._apply(self._seed(query), update)
            if "id" not in doc:
                doc["id"] = secrets.token_hex(12)
            self._write(doc)
            return _Result(matched_count=0, modified_count=0, upserted_id=doc["id"])
        return _Result(matched_count=0, modified_count=0, upserted_id=None)

    async def update_many(self, query, update):
        docs = self._all(query)
        for d in docs:
            self._write(self._apply(d, update))
        return _Result(matched_count=len(docs), modified_count=len(docs))

    async def delete_one(self, query):
        docs = self._all(query)
        if docs:
            with self.lock:
                self.conn.execute(f'DELETE FROM "{self.table}" WHERE id=?', (docs[0]["id"],))
                self.conn.commit()
            return _Result(deleted_count=1)
        return _Result(deleted_count=0)

    async def delete_many(self, query):
        docs = self._all(query)
        with self.lock:
            for d in docs:
                self.conn.execute(f'DELETE FROM "{self.table}" WHERE id=?', (d["id"],))
            self.conn.commit()
        return _Result(deleted_count=len(docs))

    async def count_documents(self, query=None):
        return len(self._all(query))

    async def find_one_and_update(self, query, update, upsert=False, return_document=False, **_):
        docs = self._all(query)
        if docs:
            doc = self._apply(docs[0], update)
            self._write(doc)
            return doc
        if upsert:
            doc = self._apply(self._seed(query), update)
            if "id" not in doc:
                doc["id"] = secrets.token_hex(12)
            self._write(doc)
            return doc
        return None

    async def create_index(self, *args, **kwargs):
        return None


class Database:
    def __init__(self, path):
        path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.lock = threading.RLock()
        self._cols = {}
        self.path = path

    def _col(self, name):
        col = self._cols.get(name)
        if col is None:
            col = self._cols[name] = Collection(self.conn, self.lock, name)
        return col

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._col(name)

    def __getitem__(self, name):
        return self._col(name)

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass
