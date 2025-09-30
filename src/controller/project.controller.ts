import express, { Response } from 'express';
import { jwtMiddleware, setOrganizationContext, requireOrganization, executeWithRLS, hasProjectAccess } from '../utils/middleware/jwtMiddleWare';
import { ActivityService } from '../services/activity.service';
const router = express.Router();

// 1. Create project (OWNER/ADMIN only)
router.post('/', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { name, slug } = req.body;
    
    if (!name || !slug) {
      return res.status(400).json({ 
        message: 'Name and slug are required' 
      });
    }

    // Check if current user is OWNER or ADMIN
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [req.organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || !['OWNER', 'ADMIN'].includes(currentUserRole[0].role)) {
      return res.status(403).json({ 
        message: 'Only OWNER or ADMIN can create projects' 
      });
    }

    // Check if slug is already taken in this organization
    const existingProject = await executeWithRLS(req, `
      SELECT id FROM projects WHERE organization_id = $1 AND slug = $2
    `, [req.organizationId, slug]);

    if (existingProject.length > 0) {
      return res.status(409).json({ 
        message: 'Project slug already exists in this organization' 
      });
    }

    // Create project
    const result = await executeWithRLS(req, `
      INSERT INTO projects (organization_id, name, slug)
      VALUES ($1, $2, $3)
      RETURNING id, name, slug, created_at
    `, [req.organizationId, name, slug]);

    const project = result[0];

    // Add creator as EDITOR of the project
    await executeWithRLS(req, `
      INSERT INTO project_members (organization_id, project_id, user_id, role)
      VALUES ($1, $2, $3, 'EDITOR')
    `, [req.organizationId, project.id, req.user!.userId]);

    // Log activity
    await ActivityService.logProjectActivity(
      req.organizationId,
      req.user!.userId,
      'created',
      name,
      project.id
    );

    res.status(201).json({
      project,
      message: 'Project created successfully'
    });

  } catch (error: any) {
    console.error('Error creating project:', error);
    res.status(500).json({ 
      message: 'Failed to create project' 
    });
  }
});

// 2. List all projects in organization
router.get('/', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    console.log('Projects GET request:', { 
      userId: req.user?.userId, 
      organizationId: req.organizationId,
    });
    const projects = await executeWithRLS(req, `
      SELECT 
        p.id,
        p.name,
        p.slug,
        p.created_at,
        pm.role as user_role
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1
      WHERE p.organization_id = $2
      ORDER BY p.created_at DESC
    `, [req.user!.userId, req.organizationId]);

    res.json({
      projects,
      count: projects.length
    });

  } catch (error: any) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ 
      message: 'Failed to fetch projects' 
    });
  }
});

// 3. Get project details
router.get('/:projectId', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    
    // Check if user has access to project
    const hasAccess = await hasProjectAccess(req, projectId);
    if (!hasAccess) {
      return res.status(403).json({ 
        message: 'Access denied to this project' 
      });
    }

    const project = await executeWithRLS(req, `
      SELECT 
        p.id,
        p.name,
        p.slug,
        p.created_at,
        pm.role as user_role
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1
      WHERE p.id = $2 AND p.organization_id = $3
    `, [req.user!.userId, projectId, req.organizationId]);

    if (project.length === 0) {
      return res.status(404).json({ 
        message: 'Project not found' 
      });
    }

    res.json({
      project: project[0]
    });

  } catch (error: any) {
    console.error('Error fetching project:', error);
    res.status(500).json({ 
      message: 'Failed to fetch project' 
    });
  }
});

// 4. Update project (EDITOR or OWNER/ADMIN)
router.put('/:projectId', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    const { name, slug } = req.body;
    
    // Check if user has EDITOR access or is OWNER/ADMIN
    const userAccess = await executeWithRLS(req, `
      SELECT 
        pm.role as project_role,
        om.role as org_role
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1
      LEFT JOIN org_memberships om ON p.organization_id = om.organization_id AND om.user_id = $1
      WHERE p.id = $2 AND p.organization_id = $3
    `, [req.user!.userId, projectId, req.organizationId]);

    if (userAccess.length === 0) {
      return res.status(404).json({ 
        message: 'Project not found' 
      });
    }

    const { project_role, org_role } = userAccess[0];
    const canEdit = project_role === 'EDITOR' || ['OWNER', 'ADMIN'].includes(org_role);

    if (!canEdit) {
      return res.status(403).json({ 
        message: 'Only EDITOR or OWNER/ADMIN can update projects' 
      });
    }

    // Check if new slug is taken (if slug is being changed)
    if (slug) {
      const existingProject = await executeWithRLS(req, `
        SELECT id FROM projects WHERE organization_id = $1 AND slug = $2 AND id != $3
      `, [req.organizationId, slug, projectId]);

      if (existingProject.length > 0) {
        return res.status(409).json({ 
          message: 'Project slug already exists in this organization' 
        });
      }
    }

    // Update project
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (name) {
      updateFields.push(`name = $${paramCount++}`);
      updateValues.push(name);
    }
    if (slug) {
      updateFields.push(`slug = $${paramCount++}`);
      updateValues.push(slug);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ 
        message: 'No fields to update' 
      });
    }

    updateValues.push(projectId, req.organizationId);

    const result = await executeWithRLS(req, `
      UPDATE projects 
      SET ${updateFields.join(', ')}, updated_at = now()
      WHERE id = $${paramCount++} AND organization_id = $${paramCount++}
      RETURNING id, name, slug, updated_at
    `, updateValues);

    res.json({
      project: result[0],
      message: 'Project updated successfully'
    });

  } catch (error: any) {
    console.error('Error updating project:', error);
    res.status(500).json({ 
      message: 'Failed to update project' 
    });
  }
});

// 5. Delete project (OWNER/ADMIN only)
router.delete('/:projectId', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    
    // Check if current user is OWNER or ADMIN
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [req.organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || !['OWNER', 'ADMIN'].includes(currentUserRole[0].role)) {
      return res.status(403).json({ 
        message: 'Only OWNER or ADMIN can delete projects' 
      });
    }

    // Check if project exists
    const project = await executeWithRLS(req, `
      SELECT id FROM projects WHERE id = $1 AND organization_id = $2
    `, [projectId, req.organizationId]);

    if (project.length === 0) {
      return res.status(404).json({ 
        message: 'Project not found' 
      });
    }

    // Log activity before deletion
    await ActivityService.logProjectActivity(
      req.organizationId,
      req.user!.userId,
      'deleted',
      project[0].name,
      projectId
    );

    // Delete project (cascade will handle project_members and tasks)
    await executeWithRLS(req, `
      DELETE FROM projects WHERE id = $1 AND organization_id = $2
    `, [projectId, req.organizationId]);

    res.json({
      message: 'Project deleted successfully',
      projectId
    });

  } catch (error: any) {
    console.error('Error deleting project:', error);
    res.status(500).json({ 
      message: 'Failed to delete project' 
    });
  }
});

// 6. Add member to project (OWNER/ADMIN only)
router.post('/:projectId/members', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    const { userId, role = 'VIEWER' } = req.body;
    
    if (!userId || !['EDITOR', 'VIEWER'].includes(role)) {
      return res.status(400).json({ 
        message: 'Valid userId and role (EDITOR/VIEWER) are required' 
      });
    }

    // Check if current user is OWNER or ADMIN
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [req.organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || !['OWNER', 'ADMIN'].includes(currentUserRole[0].role)) {
      return res.status(403).json({ 
        message: 'Only OWNER or ADMIN can add project members' 
      });
    }

    // Check if user is a member of the organization
    const orgMember = await executeWithRLS(req, `
      SELECT user_id FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [req.organizationId, userId]);

    if (orgMember.length === 0) {
      return res.status(404).json({ 
        message: 'User must be a member of the organization first' 
      });
    }

    // Check if user is already a project member
    const existingMembership = await executeWithRLS(req, `
      SELECT user_id FROM project_members 
      WHERE project_id = $1 AND user_id = $2
    `, [projectId, userId]);

    if (existingMembership.length > 0) {
      return res.status(409).json({ 
        message: 'User is already a member of this project' 
      });
    }

    // Add user to project
    await executeWithRLS(req, `
      INSERT INTO project_members (organization_id, project_id, user_id, role)
      VALUES ($1, $2, $3, $4)
    `, [req.organizationId, projectId, userId, role]);

    res.status(201).json({
      message: 'Project member added successfully',
      projectId,
      userId,
      role
    });

  } catch (error: any) {
    console.error('Error adding project member:', error);
    res.status(500).json({ 
      message: 'Failed to add project member' 
    });
  }
});

// 7. List project members
router.get('/:projectId/members', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    
    // Check if user has access to project
    const hasAccess = await hasProjectAccess(req, projectId);
    if (!hasAccess) {
      return res.status(403).json({ 
        message: 'Access denied to this project' 
      });
    }

    const members = await executeWithRLS(req, `
      SELECT 
        u.id,
        u.username,
        pm.role,
        pm.created_at as joined_at
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY pm.created_at DESC
    `, [projectId]);

    res.json({
      members,
      count: members.length
    });

  } catch (error: any) {
    console.error('Error fetching project members:', error);
    res.status(500).json({ 
      message: 'Failed to fetch project members' 
    });
  }
});

// 8. Update project member role (OWNER/ADMIN only)
router.put('/:projectId/members/:userId', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId, userId } = req.params;
    const { role } = req.body;
    
    if (!role || !['EDITOR', 'VIEWER'].includes(role)) {
      return res.status(400).json({ 
        message: 'Valid role is required (EDITOR, VIEWER)' 
      });
    }

    // Check if current user is OWNER or ADMIN
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [req.organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || !['OWNER', 'ADMIN'].includes(currentUserRole[0].role)) {
      return res.status(403).json({ 
        message: 'Only OWNER or ADMIN can update project member roles' 
      });
    }

    // Update member role
    await executeWithRLS(req, `
      UPDATE project_members 
      SET role = $1, updated_at = now()
      WHERE project_id = $2 AND user_id = $3
    `, [role, projectId, userId]);

    res.json({
      message: 'Project member role updated successfully',
      projectId,
      userId,
      role
    });

  } catch (error: any) {
    console.error('Error updating project member role:', error);
    res.status(500).json({ 
      message: 'Failed to update project member role' 
    });
  }
});

// 9. Remove project member (OWNER/ADMIN only)
router.delete('/:projectId/members/:userId', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId, userId } = req.params;
    
    // Check if current user is OWNER or ADMIN
    const currentUserRole = await executeWithRLS(req, `
      SELECT role FROM org_memberships 
      WHERE organization_id = $1 AND user_id = $2
    `, [req.organizationId, req.user!.userId]);

    if (currentUserRole.length === 0 || !['OWNER', 'ADMIN'].includes(currentUserRole[0].role)) {
      return res.status(403).json({ 
        message: 'Only OWNER or ADMIN can remove project members' 
      });
    }

    // Remove member
    await executeWithRLS(req, `
      DELETE FROM project_members 
      WHERE project_id = $1 AND user_id = $2
    `, [projectId, userId]);

    res.json({
      message: 'Project member removed successfully',
      projectId,
      userId
    });

  } catch (error: any) {
    console.error('Error removing project member:', error);
    res.status(500).json({ 
      message: 'Failed to remove project member' 
    });
  }
});

export default router;
