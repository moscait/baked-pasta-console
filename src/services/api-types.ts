/**
 * Types for the OpenZiti Edge Management API (`/edge/management/v1`) as used by this console.
 *
 * Only the fields the console reads are declared. Most are optional because they vary across
 * controller versions; treat a missing field as "unknown", not as false/empty.
 */

/** Standard response envelope. */
export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    pagination?: { limit: number; offset: number; totalCount: number };
  };
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    cause?: { message?: string; reason?: string };
  };
}

/** A reference to another entity, as embedded in list responses. */
export interface EntityRef {
  id?: string;
  name: string;
}

interface BaseEntity {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: Record<string, unknown>;
}

interface NamedEntity extends BaseEntity {
  name: string;
}

export type Semantic = 'AnyOf' | 'AllOf';

// ------------------------------------------------------------------ identities

export interface EnrollmentToken {
  id: string;
  jwt?: string;
  expiresAt?: string;
}

export interface Identity extends NamedEntity {
  typeId?: string;
  type?: EntityRef;
  isAdmin?: boolean;
  isDefaultAdmin?: boolean;
  roleAttributes?: string[];
  authenticators?: { updb?: { id: string }; cert?: { id: string } };
  enrollment?: { ott?: EnrollmentToken; updb?: EnrollmentToken; ca?: EnrollmentToken; ottca?: EnrollmentToken };
  hasEdgeRouterConnection?: boolean;
  sdkInfo?: { type?: string; appId?: string; version?: string };
}

// ------------------------------------------------------------------ services & configs

export interface Service extends NamedEntity {
  roleAttributes?: string[];
  configs?: string[];
  encryptionRequired?: boolean;
  terminatorStrategy?: string;
}

export interface ConfigType extends NamedEntity {
  schema?: Record<string, unknown>;
}

export interface Config extends NamedEntity {
  configTypeId: string;
  configType?: EntityRef;
  data: Record<string, unknown>;
}

export interface Terminator extends BaseEntity {
  serviceId: string;
  service?: EntityRef;
  routerId: string;
  router?: EntityRef;
  binding?: string;
  address?: string;
  cost?: number;
  precedence?: string;
}

// ------------------------------------------------------------------ routers

export interface EdgeRouter extends NamedEntity {
  roleAttributes?: string[];
  isOnline?: boolean;
  isVerified?: boolean;
  isTunnelerEnabled?: boolean;
  cost?: number;
  noTraversal?: boolean;
  versionInfo?: { version?: string };
  enrollmentJwt?: string;
}

export interface TransitRouter extends NamedEntity {
  isOnline?: boolean;
  isVerified?: boolean;
  cost?: number;
  enrollmentJwt?: string;
}

// ------------------------------------------------------------------ policies

interface PolicyBase extends NamedEntity {
  semantic?: Semantic;
  isSystem?: boolean;
}

export interface ServicePolicy extends PolicyBase {
  type: 'Dial' | 'Bind';
  identityRoles?: string[];
  serviceRoles?: string[];
  postureCheckRoles?: string[];
  postureCheckRolesDisplay?: { name?: string; role: string }[];
}

export interface EdgeRouterPolicy extends PolicyBase {
  identityRoles?: string[];
  edgeRouterRoles?: string[];
}

export interface ServiceEdgeRouterPolicy extends PolicyBase {
  serviceRoles?: string[];
  edgeRouterRoles?: string[];
}

export interface PostureCheck extends NamedEntity {
  typeId: string;
  roleAttributes?: string[];
  timeoutSeconds?: number;
  promptOnWake?: boolean;
  promptOnUnlock?: boolean;
  operatingSystems?: { type: string; versions?: string[] }[];
  macAddresses?: string[];
  domains?: string[];
}

// ------------------------------------------------------------------ authentication

export interface CertificateAuthority extends NamedEntity {
  isVerified?: boolean;
  isAutoCaEnrollmentEnabled?: boolean;
  isOttCaEnrollmentEnabled?: boolean;
  isAuthEnabled?: boolean;
  identityRoles?: string[];
}

export interface AuthPolicy extends NamedEntity {
  primary?: {
    cert?: { allowed?: boolean; allowExpiredCerts?: boolean };
    updb?: { allowed?: boolean; minPasswordLength?: number; requireMixedCase?: boolean };
    extJwt?: { allowed?: boolean; allowedSigners?: string[] };
  };
  secondary?: { requireTotp?: boolean; requireExtJwtSigner?: string | null };
}

export interface ExternalJwtSigner extends NamedEntity {
  issuer?: string;
  audience?: string;
  jwksEndpoint?: string;
  enabled?: boolean;
  claimsProperty?: string;
  useExternalId?: boolean;
}

// ------------------------------------------------------------------ sessions

export interface Session extends BaseEntity {
  serviceId?: string;
  service?: EntityRef;
  identityId?: string;
  type?: 'Dial' | 'Bind';
}

export interface ApiSession extends BaseEntity {
  identityId?: string;
  identity?: EntityRef;
  ipAddress?: string;
  authQueries?: unknown[];
  lastActivityAt?: string;
}

// ------------------------------------------------------------------ collection map

/** Maps each management API collection path to the entity it returns. */
export interface ApiEntities {
  identities: Identity;
  services: Service;
  'edge-routers': EdgeRouter;
  'transit-routers': TransitRouter;
  'service-policies': ServicePolicy;
  'edge-router-policies': EdgeRouterPolicy;
  'service-edge-router-policies': ServiceEdgeRouterPolicy;
  configs: Config;
  'config-types': ConfigType;
  'posture-checks': PostureCheck;
  cas: CertificateAuthority;
  'auth-policies': AuthPolicy;
  'external-jwt-signers': ExternalJwtSigner;
  terminators: Terminator;
  sessions: Session;
  'api-sessions': ApiSession;
}

export type Collection = keyof ApiEntities;

/** A request body for create/patch/put. Field names follow the management API. */
export type ApiWriteBody = object;
