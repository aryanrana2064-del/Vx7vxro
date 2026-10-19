import { z } from "zod";
import {
  API_SCOPES,
  ANALYTIC_RANGES,
  DEPLOYMENT_STATUS,
  INCIDENT_STATUS,
} from "./constants";

export const emailSchema = z.string().trim().email().max(254);

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(256, "Password too long");

export const bootstrapSchema = z.object({
  bootstrapSecret: z.string().min(8),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const mfaVerifySchema = z.object({
  challenge: z.string().min(8).max(128),
  code: z.string().trim().regex(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, "Invalid code format"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

export const mfaConfirmSchema = z.object({ code: z.string().trim().length(6) });

export const hostnameSchema = z
  .string()
  .trim()
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i, "Invalid hostname");

export const monitorUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url("Must be a valid URL")
  .refine((u) => u.startsWith("http://") || u.startsWith("https://"), "Only http(s) URLs are supported");

export const createSiteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  environment: z.enum(["production", "staging", "development"]).default("production"),
  domains: z.array(hostnameSchema).min(1).max(10),
});

export const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  environment: z.enum(["production", "staging", "development"]).optional(),
  domains: z.array(hostnameSchema).min(1).max(10).optional(),
  disabled: z.boolean().optional(),
});

export const createMonitorSchema = z.object({
  siteId: z.string().min(1).max(64),
  url: monitorUrlSchema,
  method: z.enum(["GET", "HEAD"]).default("GET"),
  intervalSeconds: z.number().int().min(60).max(86400).default(300),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
  maxRedirects: z.number().int().min(0).max(5).default(2),
  failureThreshold: z.number().int().min(1).max(10).default(2),
  expectedStatusMin: z.number().int().min(100).max(599).default(200),
  expectedStatusMax: z.number().int().min(100).max(599).default(399),
  slowThresholdMs: z.number().int().min(100).max(60000).default(3000),
});

export const updateMonitorSchema = createMonitorSchema.partial().omit({ siteId: true }).extend({ enabled: z.boolean().optional() });

export const collectAnalyticsSchema = z.object({
  v: z.literal(1),
  type: z.enum(["pageview", "custom"]),
  path: z.string().max(2048).startsWith("/"),
  name: z.string().max(100).optional(),
  referrer: z.string().max(2048).optional(),
  session: z.string().min(8).max(64),
  screen: z.enum(["mobile", "tablet", "desktop", "unknown"]).default("unknown"),
  dedupe: z.string().max(64).optional(),
});

export const collectBatchSchema = z.object({
  events: z.array(collectAnalyticsSchema).min(1).max(50),
});

export const collectPerfSchema = z.object({
  v: z.literal(1),
  metrics: z
    .array(
      z.object({
        metric: z.enum(["lcp", "inp", "cls", "fcp", "ttfb"]),
        value: z.number().finite().min(0).max(600000),
        path: z.string().max(2048).startsWith("/"),
        deployment: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(20),
  ua: z.string().max(512).optional(),
});

export const collectErrorSchema = z.object({
  v: z.literal(1),
  category: z.enum(["uncaught", "unhandledrejection", "resource", "manual"]).default("manual"),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  path: z.string().max(2048).startsWith("/").optional(),
  release: z.string().max(120).optional(),
  correlationId: z.string().max(64).optional(),
});

export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
  expiresInSeconds: z.number().int().min(3600).max(31536000).optional(),
});

export const rotateKeySchema = z.object({
  expiresInSeconds: z.number().int().min(3600).max(31536000).optional(),
});

export const createDeploymentSchema = z.object({
  siteId: z.string().min(1).max(64).optional(),
  environment: z.string().trim().min(1).max(40).default("production"),
  source: z.enum(["manual", "ci", "github", "vercel"]).default("manual"),
  status: z.enum(DEPLOYMENT_STATUS).default("ready"),
  commitSha: z.string().trim().regex(/^[a-f0-9]{7,40}$/i).optional(),
  commitMessage: z.string().trim().max(500).optional(),
  branch: z.string().trim().max(200).optional(),
  url: z.string().trim().max(2048).url().optional(),
  errorSummary: z.string().trim().max(2000).optional(),
});

export const integrationConfigSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("github"),
    token: z.string().trim().min(10).max(200),
    repo: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/, "Expected owner/repo"),
    branch: z.string().trim().min(1).max(200).default("main"),
  }),
  z.object({
    kind: z.literal("vercel"),
    token: z.string().trim().min(10).max(200),
    projectId: z.string().trim().min(1).max(120).optional(),
    teamId: z.string().trim().min(1).max(120).optional(),
  }),
]);

export const alertConfigSchema = z.object({
  webhookUrl: z.string().trim().max(2048).url().or(z.literal("")),
  webhookSecret: z.string().trim().max(200).optional(),
});

export const rangeSchema = z.enum(ANALYTIC_RANGES).default("7d");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

export const incidentUpdateSchema = z.object({
  status: z.enum(["acknowledged", "investigating", "resolved"]),
  note: z.string().trim().max(2000).optional(),
});

export const exportQuerySchema = z.object({
  dataset: z.enum([
    "analytics",
    "monitoring",
    "incidents",
    "performance",
    "errors",
    "deployments",
    "audit",
    "api_usage",
  ]),
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
  format: z.enum(["csv", "json"]).default("csv"),
  siteId: z.string().max(64).optional(),
});
