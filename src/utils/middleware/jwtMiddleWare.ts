import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { AppDataSource } from '../../config/database';
import { QueryRunner } from 'typeorm';

const app = express();
app.use(cookieParser());
app.use(express.json());

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'default-access-secret-for-demo';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-for-demo';
const ACCESS_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_IN = '7d';

interface JWTPayload {
  userId: string;
  username?: string;
  iat?: number;
  exp?: number;
}

interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
  queryRunner?: QueryRunner;
  accessToken?: string;
  organizationId?: string;
}

export const generateAccessToken = (payload: object): string => {
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
};

export const generateRefreshToken = (payload: object): string => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
};

export const verifyToken = (token: string): JWTPayload => {
  return jwt.verify(token, JWT_ACCESS_SECRET) as JWTPayload;
};

// RLS helper with transaction-local context
async function withRls<T>(
  queryRunner: QueryRunner,
  userId: string,
  organizationId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  await queryRunner.startTransaction();
  try {
    await queryRunner.query(`SELECT set_config('app.user_id', '${userId}', true)`);
    if (organizationId) {
      await queryRunner.query(`SELECT set_config('app.organization_id', '${organizationId}', true)`);
    }
    const result = await fn();
    await queryRunner.commitTransaction();
    return result;
  } catch (e) {
    await queryRunner.rollbackTransaction();
    throw e;
  }
}

async function setUserContextInDB(queryRunner: QueryRunner, userId: string, organizationId?: string): Promise<void> {
  // Always set user_id for basic user context
  await queryRunner.query(`
    SELECT set_config('app.user_id', $1, true)
  `, [userId]);

  // Only set organization context if provided
  if (organizationId) {
    const userVerification = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM org_memberships om
        JOIN users u ON u.id = om.user_id  
        WHERE om.user_id = $1 AND om.organization_id = $2
      ) as user_exists
    `, [userId, organizationId]);

    if (!userVerification[0]?.user_exists) {
      throw new Error(`User ${userId} not authorized for organization ${organizationId}`);
    }

    await queryRunner.query(`
      SELECT set_config('app.organization_id', $1, true)
    `, [organizationId]);
  }
}

export const jwtMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ code: 'missing_auth', message: 'Authorization header missing' });
  }

  const token = authHeader.split(' ')[1];

  let decoded: JWTPayload;
  try {
    decoded = verifyToken(token);
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ code: 'token_expired', message: 'Access token expired' });
    }
    return res.status(401).json({ code: 'invalid_token', message: 'Invalid access token' });
  }

  if (!decoded.userId) {
    return res.status(401).json({ code: 'invalid_claims', message: 'Invalid token: missing user data' });
  }

  const queryRunner = AppDataSource.createQueryRunner();
  try {
    await queryRunner.connect();
    req.user = decoded;
    req.queryRunner = queryRunner;
    req.accessToken = token;

    // IMPORTANT: do NOT set GUCs here globally; set them per-query via withRls()
    // or run a request-scoped transaction & SET LOCAL if your handlers are disciplined.

    // Ensure release in all cases
    res.on('finish', async () => {
      try { if (!queryRunner.isReleased) await queryRunner.release(); } catch {}
    });

    next();
  } catch (e) {
    try { if (!queryRunner.isReleased) await queryRunner.release(); } catch {}
    return res.status(500).json({ code: 'db_connect_failed', message: 'DB connection failed' });
  }
};



export const getUserOrganizations = async (req: AuthenticatedRequest) => {
  if (!req.user || !req.queryRunner) {
    return [];
  }
  
  try {
    // Query without RLS since we're getting user's own organizations
    const result = await req.queryRunner.query(`
      SELECT o.id, o.name, o.subdomain, om.role
      FROM organizations o
      JOIN org_memberships om ON o.id = om.organization_id
      WHERE om.user_id = $1
      ORDER BY o.name
    `, [req.user.userId]);
    
    return result;
  } catch (error) {
    return [];
  }
};

export const switchOrganization = async (req: AuthenticatedRequest, organizationId: string) => {
  if (!req.user || !req.queryRunner) {
    throw new Error('No user context available');
  }
  
  const hasAccess = await hasOrgAccess(req, organizationId);
  if (!hasAccess) {
    throw new Error('User does not have access to this organization');
  }
  
  await setUserContextInDB(req.queryRunner, req.user.userId, organizationId);
  req.organizationId = organizationId;
  
  return true;
};

export const setOrganizationContext = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Extract organizationId from URL path, query params, or body
  let organizationId = req.params?.organizationId || req.query?.organizationId as string || req.body?.organizationId;
  
  // If not found in params, try to extract from the original URL
  if (!organizationId && req.originalUrl) {
    const urlMatch = req.originalUrl.match(/\/organizations\/([^\/]+)/);
    if (urlMatch) {
      organizationId = urlMatch[1];
    }
  }
  
  console.log('setOrganizationContext:', { 
    organizationId, 
    hasQueryRunner: !!req.queryRunner,
    params: req.params,
    query: req.query,
    url: req.url,
    originalUrl: req.originalUrl
  });
  
  if (organizationId && req.queryRunner) {
    try {
      await setUserContextInDB(req.queryRunner, req.user!.userId, organizationId);
      req.organizationId = organizationId;
    } catch (error) {
      return res.status(403).json({ 
        message: 'Invalid organization access' 
      });
    }
  }
  
  next();
};

export const requireOrganization = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  console.log('requireOrganization:', { organizationId: req.organizationId });
  if (!req.organizationId) {
    return res.status(400).json({ 
      message: 'Organization context required. Please provide organizationId in URL path, query params, or body.' 
    });
  }
  
  next();
};

export const executeWithRLS = async (
  req: AuthenticatedRequest,
  query: string,
  params: any[] = []
) => {
  if (!req.queryRunner || !req.user) {
    throw new Error('No DB connection or user context available');
  }
  
  return withRls(req.queryRunner, req.user.userId, req.organizationId, () =>
    req.queryRunner!.query(query, params)
  );
};

export const hasOrgAccess = async (req: AuthenticatedRequest, organizationId: string): Promise<boolean> => {
  if (!req.user || !req.queryRunner) {
    return false;
  }
  
  try {
    const result = await req.queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM org_memberships 
        WHERE organization_id = $1 AND user_id = $2
      ) as has_access
    `, [organizationId, req.user.userId]);
    
    return result[0]?.has_access || false;
  } catch (error) {
    return false;
  }
};

export const hasProjectAccess = async (req: AuthenticatedRequest, projectId: string): Promise<boolean> => {
  if (!req.user || !req.queryRunner || !req.organizationId) {
    console.log('hasProjectAccess: Missing context', { 
      hasUser: !!req.user, 
      hasQueryRunner: !!req.queryRunner, 
      organizationId: req.organizationId 
    });
    return false;
  }
  
  try {
    const result = await req.queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM projects p
        LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1
        LEFT JOIN org_memberships om ON p.organization_id = om.organization_id AND om.user_id = $1
        WHERE p.id = $2 AND p.organization_id = $3
        AND (pm.user_id IS NOT NULL OR om.role IN ('OWNER', 'ADMIN'))
      ) as has_access
    `, [req.user.userId, projectId, req.organizationId]);
    
    console.log('hasProjectAccess result:', { 
      userId: req.user.userId, 
      userIdType: typeof req.user.userId,
      projectId, 
      projectIdType: typeof projectId,
      organizationId: req.organizationId, 
      organizationIdType: typeof req.organizationId,
      hasAccess: result[0]?.has_access 
    });
    
    return result[0]?.has_access || false;
  } catch (error) {
    console.error('hasProjectAccess error:', error);
    return false;
  }
};



