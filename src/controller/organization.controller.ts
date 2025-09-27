import express, { Request, Response } from 'express';
import { jwtMiddleware, setOrganizationContext, requireOrganization, executeWithRLS, getUserOrganizations, switchOrganization } from '../utils/middleware/jwtMiddleWare';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    username?: string;
    iat?: number;
    exp?: number;
  };
  queryRunner?: any;
  accessToken?: string;
  organizationId?: string;
}

const router = express.Router();

// Apply JWT middleware to all routes
router.use(jwtMiddleware as any);

// 1. Create organization
router.post('/', async (req: any, res: Response) => {
  try {
    const { name, subdomain } = req.body;
    
    if (!name || !subdomain) {
      return res.status(400).json({ 
        message: 'Name and subdomain are required' 
      });
    }

    if (!req.queryRunner) {
      return res.status(500).json({ 
        message: 'Database connection not available' 
      });
    }

    // Check if subdomain is already taken (without RLS since we're creating)
    const existingOrg = await req.queryRunner.query(`
      SELECT id FROM organizations WHERE subdomain = $1
    `, [subdomain]);

    if (existingOrg.length > 0) {
      return res.status(409).json({ 
        message: 'Subdomain already exists' 
      });
    }

    // Create organization (without RLS since we're creating)
    const result = await req.queryRunner.query(`
      INSERT INTO organizations (name, subdomain)
      VALUES ($1, $2)
      RETURNING id, name, subdomain, created_at
    `, [name, subdomain]);

    const organization = result[0];

    // Add user as owner of the organization (without RLS since we're creating)
    await req.queryRunner.query(`
      INSERT INTO org_memberships (organization_id, user_id, role)
      VALUES ($1, $2, 'OWNER')
    `, [organization.id, req.user!.userId]);

    res.status(201).json({
      organization,
      message: 'Organization created successfully'
    });

  } catch (error: any) {
    console.error('Error creating organization:', error);
    res.status(500).json({ 
      message: 'Failed to create organization' 
    });
  }
});

// 2. List all organizations user is part of
router.get('/', async (req: any, res: Response) => {
  try {
    const organizations = await getUserOrganizations(req);
    
    res.json({
      organizations,
      count: organizations.length
    });

  } catch (error: any) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ 
      message: 'Failed to fetch organizations' 
    });
  }
});

// 3. Switch to a workspace/connect to a workspace
router.post('/switch/:organizationId', async (req: any, res: Response) => {
  try {
    const { organizationId } = req.params;
    
    if (!organizationId) {
      return res.status(400).json({ 
        message: 'Organization ID is required' 
      });
    }

    await switchOrganization(req, organizationId);

    res.json({
      message: 'Successfully switched to organization',
      organizationId: req.organizationId
    });

  } catch (error: any) {
    console.error('Error switching organization:', error);
    res.status(403).json({ 
      message: error.message || 'Failed to switch organization' 
    });
  }
});

// Additional endpoint: Get current organization context
router.get('/current', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const organization = await executeWithRLS(req, `
      SELECT o.id, o.name, o.subdomain, om.role
      FROM organizations o
      JOIN org_memberships om ON o.id = om.organization_id
      WHERE o.id = $1 AND om.user_id = $2
    `, [req.organizationId, req.user!.userId]);

    if (organization.length === 0) {
      return res.status(404).json({ 
        message: 'Organization not found or access denied' 
      });
    }

    res.json({
      organization: organization[0]
    });

  } catch (error: any) {
    console.error('Error fetching current organization:', error);
    res.status(500).json({ 
      message: 'Failed to fetch current organization' 
    });
  }
});

// Add member to organization (OWNER/ADMIN only)
router.post('/:organizationId/members', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { organizationId } = req.params;
    const { userId, role = 'USER' } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        message: 'User ID is required' 
      });
    }

    // Check if current user is OWNER or ADMIN
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || !['OWNER', 'ADMIN'].includes(currentUserRole[0].role)) {
      return res.status(403).json({ 
        message: 'Only OWNER or ADMIN can add members' 
      });
    }

    // Check if user exists
    const userExists = await executeWithRLS(req, `
      SELECT id FROM users WHERE id = $1
    `, [userId]);

    if (userExists.length === 0) {
      return res.status(404).json({ 
        message: 'User not found' 
      });
    }

    // Check if user is already a member
    const existingMembership = await executeWithRLS(req, `
      SELECT * FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, userId]);

    if (existingMembership.length > 0) {
      return res.status(409).json({ 
        message: 'User is already a member of this organization' 
      });
    }

    // Add user to organization
    await executeWithRLS(req, `
      INSERT INTO org_memberships (organization_id, user_id, role)
      VALUES ($1, $2, $3)
    `, [organizationId, userId, role]);

    res.status(201).json({
      message: 'Member added successfully',
      organizationId,
      userId,
      role
    });

  } catch (error: any) {
    console.error('Error adding member:', error);
    res.status(500).json({ 
      message: 'Failed to add member' 
    });
  }
});

// List organization members (OWNER/ADMIN only)
router.get('/:organizationId/members', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { organizationId } = req.params;
    
    // Check if current user is OWNER or ADMIN
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || !['OWNER', 'ADMIN'].includes(currentUserRole[0].role)) {
      return res.status(403).json({ 
        message: 'Only OWNER or ADMIN can view members' 
      });
    }

    // Get all members
    const members = await executeWithRLS(req, `
      SELECT 
        u.id,
        u.username,
        om.role,
        om.created_at as joined_at
      FROM org_memberships om
      JOIN users u ON u.id = om.user_id
      WHERE om.organization_id = $1
      ORDER BY om.created_at DESC
    `, [organizationId]);

    res.json({
      members,
      count: members.length
    });

  } catch (error: any) {
    console.error('Error fetching members:', error);
    res.status(500).json({ 
      message: 'Failed to fetch members' 
    });
  }
});

// Update member role (OWNER/ADMIN only)
router.put('/:organizationId/members/:userId', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { organizationId, userId } = req.params;
    const { role } = req.body;
    
    if (!role || !['OWNER', 'ADMIN', 'USER'].includes(role)) {
      return res.status(400).json({ 
        message: 'Valid role is required (OWNER, ADMIN, USER)' 
      });
    }

    // Check if current user is OWNER or ADMIN
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || !['OWNER', 'ADMIN'].includes(currentUserRole[0].role)) {
      return res.status(403).json({ 
        message: 'Only OWNER or ADMIN can update member roles' 
      });
    }

    // OWNER cannot change their own role
    if (req.user!.userId === userId) {
      return res.status(403).json({ 
        message: 'You cannot change your own role' 
      });
    }

    // ADMIN cannot promote to OWNER or demote OWNER
    if (currentUserRole[0].role === 'ADMIN') {
      if (role === 'OWNER') {
        return res.status(403).json({ 
          message: 'ADMIN cannot promote users to OWNER' 
        });
      }
      
      const targetUserRole = await executeWithRLS(req, `
        SELECT role FROM org_memberships 
        WHERE organization_id = $1 AND user_id = $2
      `, [organizationId, userId]);
      
      if (targetUserRole.length > 0 && targetUserRole[0].role === 'OWNER') {
        return res.status(403).json({ 
          message: 'ADMIN cannot modify OWNER role' 
        });
      }
    }

    // Update member role
    await executeWithRLS(req, `
      UPDATE org_memberships 
      SET role = $1, updated_at = now()
      WHERE organization_id = $2 AND user_id = $3
    `, [role, organizationId, userId]);

    res.json({
      message: 'Member role updated successfully',
      organizationId,
      userId,
      role
    });

  } catch (error: any) {
    console.error('Error updating member role:', error);
    res.status(500).json({ 
      message: 'Failed to update member role' 
    });
  }
});

// Remove member from organization (OWNER/ADMIN only)
router.delete('/:organizationId/members/:userId', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { organizationId, userId } = req.params;
    
    // Check if current user is OWNER or ADMIN
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || !['OWNER', 'ADMIN'].includes(currentUserRole[0].role)) {
      return res.status(403).json({ 
        message: 'Only OWNER or ADMIN can remove members' 
      });
    }

    // Check if target user exists in organization
    const targetUser = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, userId]);

    if (targetUser.length === 0) {
      return res.status(404).json({ 
        message: 'User is not a member of this organization' 
      });
    }

    // ADMIN cannot remove OWNER
    if (currentUserRole[0].role === 'ADMIN' && targetUser[0].role === 'OWNER') {
      return res.status(403).json({ 
        message: 'ADMIN cannot remove OWNER' 
      });
    }

    // OWNER cannot remove themselves (prevent lockout)
    if (req.user!.userId === userId && targetUser[0].role === 'OWNER') {
      return res.status(403).json({ 
        message: 'OWNER cannot remove themselves. Transfer ownership first.' 
      });
    }

    // Remove member
    await executeWithRLS(req, `
      DELETE FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, userId]);

    res.json({
      message: 'Member removed successfully',
      organizationId,
      userId
    });

  } catch (error: any) {
    console.error('Error removing member:', error);
    res.status(500).json({ 
      message: 'Failed to remove member' 
    });
  }
});

// Transfer ownership (OWNER only)
router.post('/:organizationId/transfer-ownership', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { organizationId } = req.params;
    const { newOwnerId } = req.body;
    
    if (!newOwnerId) {
      return res.status(400).json({ 
        message: 'New owner ID is required' 
      });
    }

    // Check if current user is OWNER
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || currentUserRole[0].role !== 'OWNER') {
      return res.status(403).json({ 
        message: 'Only OWNER can transfer ownership' 
      });
    }

    // Check if new owner is a member
    const newOwner = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, newOwnerId]);

    if (newOwner.length === 0) {
      return res.status(404).json({ 
        message: 'New owner must be a member of the organization' 
      });
    }

    // Transfer ownership
    await executeWithRLS(req, `
      BEGIN;
      UPDATE org_memberships SET role = 'ADMIN' WHERE organization_id = $1 AND user_id = $2;
      UPDATE org_memberships SET role = 'OWNER' WHERE organization_id = $1 AND user_id = $3;
      COMMIT;
    `, [organizationId, req.user!.userId, newOwnerId]);

    res.json({
      message: 'Ownership transferred successfully',
      organizationId,
      newOwnerId
    });

  } catch (error: any) {
    console.error('Error transferring ownership:', error);
    res.status(500).json({ 
      message: 'Failed to transfer ownership' 
    });
  }
});

export default router;
