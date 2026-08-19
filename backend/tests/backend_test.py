"""Backend regression tests for VYRO VX7 POS.
Covers: health, login, products list/create, stock adjust, dashboard low-stock.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    "https://jbx-inventory-hub.preview.emergentagent.com"
API = f"{BASE_URL}/api"

OWNER_EMAIL = "owner@euue.com"
OWNER_PASS = "euue123"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def token(session):
    r = session.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=30)
    assert r.status_code == 200, f"Login failed {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="session")
def auth(session, token):
    session.headers.update({"Authorization": f"Bearer {token}"})
    return session


# ---- Health
def test_health(session):
    r = session.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# ---- Auth
def test_login_wrong_password(session):
    r = session.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": "wrongpass"}, timeout=15)
    assert r.status_code in (401, 429)


def test_login_success_returns_user(auth):
    r = auth.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["user"]["email"] == OWNER_EMAIL


# ---- Products
def test_list_products(auth):
    r = auth.get(f"{API}/products", timeout=20)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_product_starts_at_zero_stock(auth):
    code = f"TEST-{uuid.uuid4().hex[:6].upper()}"
    payload = {"code": code, "name": "Auto Test Product", "brand": "TestBrand",
               "category": "General", "unit": "Piece", "price": 20, "purchasePrice": 10,
               "stock": 0, "minStock": 5}
    r = auth.post(f"{API}/products", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    prod = r.json()
    assert prod["code"] == code
    assert float(prod["stock"]) == 0.0

    # Verify persistence via list
    r2 = auth.get(f"{API}/products", timeout=20)
    assert any(p["code"] == code for p in r2.json())

    # cleanup
    auth.delete(f"{API}/products/{prod['id']}", timeout=15)


def test_create_duplicate_product_code(auth):
    code = f"TEST-{uuid.uuid4().hex[:6].upper()}"
    p = {"code": code, "name": "Dup", "price": 5}
    r1 = auth.post(f"{API}/products", json=p, timeout=15)
    assert r1.status_code == 200
    r2 = auth.post(f"{API}/products", json=p, timeout=15)
    assert r2.status_code == 400
    auth.delete(f"{API}/products/{r1.json()['id']}", timeout=15)


# ---- Stock adjust
def test_stock_adjust_in_and_out(auth):
    code = f"TEST-{uuid.uuid4().hex[:6].upper()}"
    r = auth.post(f"{API}/products", json={"code": code, "name": "Stock Test", "price": 10, "minStock": 5}, timeout=15)
    assert r.status_code == 200
    pid = r.json()["id"]
    # +10
    r2 = auth.post(f"{API}/stock/adjust", json={"productId": pid, "qty": 10, "type": "in", "reason": "Test add"}, timeout=15)
    assert r2.status_code == 200, r2.text
    assert float(r2.json()["stock"]) == 10.0
    # -3
    r3 = auth.post(f"{API}/stock/adjust", json={"productId": pid, "qty": 3, "type": "out", "reason": "Test remove"}, timeout=15)
    assert r3.status_code == 200
    assert float(r3.json()["stock"]) == 7.0
    auth.delete(f"{API}/products/{pid}", timeout=15)


# ---- Password recovery: signup with hint, forgot, reset, and change-password
@pytest.fixture(scope="module")
def throwaway_shop(session):
    email = f"qa+{uuid.uuid4().hex[:8]}@euue.com"
    password = "orig123"
    payload = {
        "businessName": "QA Auto Shop", "businessType": "General Retail",
        "ownerName": "QA Owner", "email": email, "password": password,
        "phone": "9990001111", "address": "Test", "gstin": "",
        "securityHint": "pet name", "securityAnswer": "Rex",
    }
    r = session.post(f"{API}/auth/signup-shop", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and "licenseKey" in data
    return {"email": email, "password": password, "token": data["token"]}


def test_forgot_returns_hint(session, throwaway_shop):
    r = session.post(f"{API}/auth/forgot", json={"email": throwaway_shop["email"]}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("hint") == "pet name"


def test_forgot_owner_without_answer_errors(session):
    r = session.post(f"{API}/auth/forgot", json={"email": OWNER_EMAIL}, timeout=15)
    assert r.status_code == 400


def test_reset_wrong_answer_rejected(session, throwaway_shop):
    r = session.post(f"{API}/auth/reset", json={
        "email": throwaway_shop["email"], "answer": "wrong", "newPassword": "abcdef"
    }, timeout=15)
    assert r.status_code == 401


def test_reset_correct_answer_then_login(session, throwaway_shop):
    new_pw = "newpass9"
    r = session.post(f"{API}/auth/reset", json={
        "email": throwaway_shop["email"], "answer": "rex", "newPassword": new_pw
    }, timeout=15)
    assert r.status_code == 200
    # login with new password
    r2 = session.post(f"{API}/auth/login", json={"email": throwaway_shop["email"], "password": new_pw}, timeout=15)
    assert r2.status_code == 200
    throwaway_shop["password"] = new_pw
    throwaway_shop["token"] = r2.json()["token"]


def test_change_password_flow(session, throwaway_shop):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {throwaway_shop['token']}"})
    # wrong current
    r_bad = s.post(f"{API}/auth/change-password", json={"currentPassword": "nope", "newPassword": "abcdef"}, timeout=15)
    assert r_bad.status_code == 400
    # correct
    new_pw = "changed9"
    r = s.post(f"{API}/auth/change-password",
               json={"currentPassword": throwaway_shop["password"], "newPassword": new_pw}, timeout=15)
    assert r.status_code == 200
    # login with new
    r2 = session.post(f"{API}/auth/login",
                      json={"email": throwaway_shop["email"], "password": new_pw}, timeout=15)
    assert r2.status_code == 200


# ---- Returns: refund from bill restocks
def test_return_from_sale_restocks(auth):
    code = f"TEST-RET-{uuid.uuid4().hex[:5].upper()}"
    r = auth.post(f"{API}/products", json={"code": code, "name": "Ret Test", "price": 50, "purchasePrice": 20, "minStock": 1}, timeout=15)
    assert r.status_code == 200
    pid = r.json()["id"]
    # stock in 5
    auth.post(f"{API}/stock/adjust", json={"productId": pid, "qty": 5, "type": "in", "reason": "seed"}, timeout=15)
    # sell 3
    sale_body = {"items": [{"productId": pid, "name": "Ret Test", "code": code, "unit": "",
                            "price": 50, "qty": 3, "purchasePrice": 20, "quickBill": False}],
                 "customerId": "", "discount": 0, "taxPercent": 0,
                 "payments": [{"mode": "Cash", "amount": 150}], "note": "", "clientRef": uuid.uuid4().hex, "device": "test"}
    rs = auth.post(f"{API}/sales", json=sale_body, timeout=20)
    assert rs.status_code == 200, rs.text
    sale = rs.json()
    # stock should be 2
    prod = [p for p in auth.get(f"{API}/products").json() if p["id"] == pid][0]
    assert float(prod["stock"]) == 2.0
    # create return for 2 units
    rr = auth.post(f"{API}/returns", json={"kind": "sale", "refId": sale["id"], "refundMode": "Cash",
                                           "items": [{"productId": pid, "name": "Ret Test", "code": code, "qty": 2, "price": 50}], "note": "test"}, timeout=20)
    assert rr.status_code == 200, rr.text
    ret = rr.json()
    assert ret.get("returnNo", "").startswith("RET-")
    assert ret.get("invoiceNo") == sale["invoiceNo"]
    assert ret.get("refundMode") == "Cash"
    # stock should now be 4
    prod2 = [p for p in auth.get(f"{API}/products").json() if p["id"] == pid][0]
    assert float(prod2["stock"]) == 4.0
    # cleanup
    auth.delete(f"{API}/products/{pid}", timeout=15)


# ---- Customers, Suppliers, Purchases, Sales (Quick Bill), Reports, Users, License, Categories, Movements
def test_categories_endpoint(auth):
    r = auth.get(f"{API}/categories", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body.get("categories"), list)


def test_users_list(auth):
    r = auth.get(f"{API}/users", timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_license_endpoint(auth):
    r = auth.get(f"{API}/license", timeout=15)
    assert r.status_code == 200
    # trial license expected
    lic = r.json()
    if lic:
        assert "key" in lic and "status" in lic


def test_shop_get(auth):
    r = auth.get(f"{API}/shop", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "shop" in body and "businessName" in body["shop"]


def test_customer_create_and_payment(auth):
    name = f"TEST_Cust_{uuid.uuid4().hex[:6]}"
    r = auth.post(f"{API}/customers", json={"name": name, "phone": "9999", "address": "x", "openingBalance": 500}, timeout=15)
    assert r.status_code == 200, r.text
    cust = r.json()
    assert cust["name"] == name
    assert float(cust["balance"]) == 500
    cid = cust["id"]
    # payment reduces balance
    rp = auth.post(f"{API}/customers/{cid}/payment", json={"amount": 200, "mode": "Cash", "note": "t"}, timeout=15)
    assert rp.status_code == 200
    assert float(rp.json()["balance"]) == 300
    # ledger returns rows
    rl = auth.get(f"{API}/customers/{cid}/ledger", timeout=15)
    assert rl.status_code == 200
    assert "rows" in rl.json()


def test_supplier_create_and_purchase(auth):
    sname = f"TEST_Sup_{uuid.uuid4().hex[:6]}"
    r = auth.post(f"{API}/suppliers", json={"name": sname, "phone": "8888", "address": "y", "openingBalance": 0}, timeout=15)
    assert r.status_code == 200
    sid = r.json()["id"]
    # create a product to purchase
    code = f"TEST-P-{uuid.uuid4().hex[:5].upper()}"
    rp = auth.post(f"{API}/products", json={"code": code, "name": "Purchase Item", "price": 100, "purchasePrice": 50, "minStock": 1}, timeout=15)
    assert rp.status_code == 200
    pid = rp.json()["id"]
    # create purchase +10 @ 60
    body = {"supplierId": sid, "supplierInvoice": "SUP-TEST",
            "items": [{"productId": pid, "name": "Purchase Item", "code": code, "qty": 10, "price": 60}],
            "taxPercent": 0, "paid": 200, "note": ""}
    rpur = auth.post(f"{API}/purchases", json=body, timeout=20)
    assert rpur.status_code == 200, rpur.text
    pur = rpur.json()
    assert pur.get("purchaseNo", "").startswith("PUR-")
    # product stock should be 10, purchase price updated to 60
    prod = [p for p in auth.get(f"{API}/products").json() if p["id"] == pid][0]
    assert float(prod["stock"]) == 10.0
    assert float(prod["purchasePrice"]) == 60.0
    # supplier balance = due 400 (10*60 - 200)
    sup = [s for s in auth.get(f"{API}/suppliers").json() if s["id"] == sid][0]
    assert float(sup["balance"]) == 400
    # cleanup
    auth.delete(f"{API}/products/{pid}", timeout=15)


def test_sale_with_quick_bill_and_stock_decrement(auth):
    code = f"TEST-QB-{uuid.uuid4().hex[:5].upper()}"
    r = auth.post(f"{API}/products", json={"code": code, "name": "QB Test", "price": 30, "purchasePrice": 10, "minStock": 1}, timeout=15)
    pid = r.json()["id"]
    auth.post(f"{API}/stock/adjust", json={"productId": pid, "qty": 8, "type": "in", "reason": "seed"}, timeout=15)
    sale_body = {"items": [
        {"productId": pid, "name": "QB Test", "code": code, "unit": "", "price": 30, "qty": 2, "purchasePrice": 10, "quickBill": False},
        {"productId": "QB-adhoc", "name": "Adhoc Service", "code": "", "unit": "", "price": 45, "qty": 1, "purchasePrice": 0, "quickBill": True},
    ], "customerId": "", "discount": 0, "taxPercent": 0,
        "payments": [{"mode": "Cash", "amount": 105}], "note": "", "clientRef": uuid.uuid4().hex, "device": "test"}
    rs = auth.post(f"{API}/sales", json=sale_body, timeout=20)
    assert rs.status_code == 200, rs.text
    sale = rs.json()
    assert sale.get("invoiceNo", "").startswith("INV-")
    assert float(sale["total"]) == 105
    # stock decreased by 2
    prod = [p for p in auth.get(f"{API}/products").json() if p["id"] == pid][0]
    assert float(prod["stock"]) == 6.0
    auth.delete(f"{API}/products/{pid}", timeout=15)


def test_reports_day_close(auth):
    r = auth.get(f"{API}/reports/day-close", timeout=20)
    assert r.status_code == 200
    d = r.json()
    for k in ("date", "bills", "netSales", "returnCount", "modes"):
        assert k in d


def test_movements_list(auth):
    r = auth.get(f"{API}/movements", timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_sales_list_persists(auth):
    r = auth.get(f"{API}/sales", timeout=20)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_returns_list_persists(auth):
    r = auth.get(f"{API}/returns", timeout=20)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_superadmin_login_and_admin_endpoints(session):
    r = session.post(f"{API}/auth/login", json={"email": "admin@vyrovx7.app", "password": "VXROVX7"}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    r1 = s.get(f"{API}/admin/licenses", timeout=15)
    assert r1.status_code == 200
    assert isinstance(r1.json(), list)
    r2 = s.get(f"{API}/admin/shops", timeout=15)
    assert r2.status_code == 200
    assert isinstance(r2.json(), list)


# ---- Dashboard low stock
def test_dashboard_low_stock(auth):
    # create a low stock product
    code = f"TESTLOW-{uuid.uuid4().hex[:5].upper()}"
    r = auth.post(f"{API}/products", json={"code": code, "name": "Low Item", "price": 5, "minStock": 10}, timeout=15)
    assert r.status_code == 200
    pid = r.json()["id"]
    auth.post(f"{API}/stock/adjust", json={"productId": pid, "qty": 2, "type": "in", "reason": "seed"}, timeout=15)
    r2 = auth.get(f"{API}/dashboard", timeout=20)
    assert r2.status_code == 200
    data = r2.json()
    assert "lowStockCount" in data
    assert data["lowStockCount"] >= 1
    codes = [p.get("code") for p in data.get("lowStock", [])]
    # cleanup
    auth.delete(f"{API}/products/{pid}", timeout=15)
