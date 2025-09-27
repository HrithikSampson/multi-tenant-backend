import express, { Request, Response } from 'express';
import { jwtMiddleware, setOrganizationContext, requireOrganization, executeWithRLS, hasProjectAccess } from '../utils/middleware/jwtMiddleWare';
import { TaskStatus, ActivityKind } from '../db/enums';

const router = express.Router();

// Apply JWT middleware to all routes
router.use(jwtMiddleware as any);

// 1. Create task (OWNER/ADMIN/EDITOR only)
router.post('/:projectId/tasks', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    const { title, description, assigneeId, dueDate, priority } = req.body;
    
    if (!title) {
      return res.status(400).json({ 
        message: 'Title is required' 
      });
    }

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
    const canCreate = project_role === 'EDITOR' || ['OWNER', 'ADMIN'].includes(org_role);

    if (!canCreate) {
      return res.status(403).json({ 
        message: 'Only EDITOR or OWNER/ADMIN can create tasks' 
      });
    }

    // Validate assignee is a project member (if assigneeId provided)
    if (assigneeId) {
      const assigneeCheck = await executeWithRLS(req, `
        SELECT id FROM project_members 
        WHERE project_id = $1 AND user_id = $2
      `, [projectId, assigneeId]);

      if (assigneeCheck.length === 0) {
        return res.status(400).json({ 
          message: 'Assignee must be a project member' 
        });
      }
    }

    // Create task
    const result = await executeWithRLS(req, `
      INSERT INTO tasks (
        organization_id, project_id, title, description, 
        assignee_id, due_date, priority, created_by, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'TODO')
      RETURNING id, title, description, status, assignee_id, due_date, priority, created_at
    `, [req.organizationId, projectId, title, description, assigneeId, dueDate, priority, req.user!.userId]);

    const task = result[0];

    // Create activity log
    await executeWithRLS(req, `
      INSERT INTO activities (organization_id, actor_id, kind, message, object_type, object_id)
      VALUES ($1, $2, 'NOTIFY', $3, 'task', $4)
    `, [req.organizationId, req.user!.userId, `${req.user!.username} created task "${title}"`, task.id]);

    res.status(201).json({
      task,
      message: 'Task created successfully'
    });

  } catch (error: any) {
    console.error('Error creating task:', error);
    res.status(500).json({ 
      message: 'Failed to create task' 
    });
  }
});

// 2. List tasks in project
router.get('/:projectId/tasks', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    const { status } = req.query;
    
    // Check if user has access to project
    const hasAccess = await hasProjectAccess(req, projectId);
    if (!hasAccess) {
      return res.status(403).json({ 
        message: 'Access denied to this project' 
      });
    }

    let query = `
      SELECT 
        t.id, t.title, t.description, t.status, t.assignee_id, 
        t.due_date, t.priority, t.order_in_board, t.created_by, t.created_at, t.updated_at,
        u.username as assignee_username,
        cu.username as created_by_username
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users cu ON t.created_by = cu.id
      WHERE t.project_id = $1 AND t.organization_id = $2
    `;
    
    const params = [projectId, req.organizationId];
    
    if (status) {
      query += ` AND t.status = $3`;
      params.push(status as string);
    }
    
    query += ` ORDER BY t.order_in_board ASC, t.created_at DESC`;
    
    const tasks = await executeWithRLS(req, query, params);
    
    res.json({
      tasks,
      count: tasks.length
    });

  } catch (error: any) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ 
      message: 'Failed to fetch tasks' 
    });
  }
});

// 3. Update task (Assignee can change status, EDITOR/OWNER/ADMIN can change everything)
router.put('/:projectId/tasks/:taskId', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId, taskId } = req.params;
    const { title, description, status, assigneeId, dueDate, priority, orderInBoard } = req.body;
    
    // Get task details
    const task = await executeWithRLS(req, `
      SELECT t.*, p.organization_id
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.id = $1 AND t.project_id = $2 AND p.organization_id = $3
    `, [taskId, projectId, req.organizationId]);

    if (task.length === 0) {
      return res.status(404).json({ 
        message: 'Task not found' 
      });
    }

    const currentTask = task[0];
    const isAssignee = currentTask.assignee_id === req.user!.userId;
    
    // Check permissions
    const userAccess = await executeWithRLS(req, `
      SELECT 
        pm.role as project_role,
        om.role as org_role
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1
      LEFT JOIN org_memberships om ON p.organization_id = om.organization_id AND om.user_id = $1
      WHERE p.id = $2 AND p.organization_id = $3
    `, [req.user!.userId, projectId, req.organizationId]);

    const { project_role, org_role } = userAccess[0];
    const isEditor = project_role === 'EDITOR' || ['OWNER', 'ADMIN'].includes(org_role);
    
    // Only assignee can change status, or EDITOR/OWNER/ADMIN
    if (status !== undefined && !isAssignee && !isEditor) {
      return res.status(403).json({ 
        message: 'Only assignee or EDITOR/OWNER/ADMIN can change task status' 
      });
    }

    // Only EDITOR/OWNER/ADMIN can change other fields
    if ((title !== undefined || description !== undefined || assigneeId !== undefined || 
         dueDate !== undefined || priority !== undefined || orderInBoard !== undefined) && !isEditor) {
      return res.status(403).json({ 
        message: 'Only EDITOR or OWNER/ADMIN can update task details' 
      });
    }

    // Validate assignee is a project member (if assigneeId is being changed)
    if (assigneeId !== undefined && assigneeId !== null) {
      const assigneeCheck = await executeWithRLS(req, `
        SELECT id FROM project_members 
        WHERE project_id = $1 AND user_id = $2
      `, [projectId, assigneeId]);

      if (assigneeCheck.length === 0) {
        return res.status(400).json({ 
          message: 'Assignee must be a project member' 
        });
      }
    }

    // Build update query
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (title !== undefined) {
      updateFields.push(`title = $${paramCount++}`);
      updateValues.push(title);
    }
    if (description !== undefined) {
      updateFields.push(`description = $${paramCount++}`);
      updateValues.push(description);
    }
    if (status !== undefined) {
      updateFields.push(`status = $${paramCount++}`);
      updateValues.push(status);
    }
    if (assigneeId !== undefined) {
      updateFields.push(`assignee_id = $${paramCount++}`);
      updateValues.push(assigneeId);
    }
    if (dueDate !== undefined) {
      updateFields.push(`due_date = $${paramCount++}`);
      updateValues.push(dueDate);
    }
    if (priority !== undefined) {
      updateFields.push(`priority = $${paramCount++}`);
      updateValues.push(priority);
    }
    if (orderInBoard !== undefined) {
      updateFields.push(`order_in_board = $${paramCount++}`);
      updateValues.push(orderInBoard);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ 
        message: 'No fields to update' 
      });
    }

    updateFields.push(`updated_by = $${paramCount++}`);
    updateValues.push(req.user!.userId);
    updateValues.push(taskId);

    const result = await executeWithRLS(req, `
      UPDATE tasks 
      SET ${updateFields.join(', ')}, updated_at = now()
      WHERE id = $${paramCount++}
      RETURNING id, title, description, status, assignee_id, due_date, priority, order_in_board, updated_at
    `, updateValues);

    // Create activity log
    let activityMessage = '';
    if (status !== undefined && status !== currentTask.status) {
      activityMessage = `${req.user!.username} updated task "${currentTask.title}" to ${status}`;
    } else {
      activityMessage = `${req.user!.username} updated task "${currentTask.title}"`;
    }

    await executeWithRLS(req, `
      INSERT INTO activities (organization_id, actor_id, kind, message, object_type, object_id)
      VALUES ($1, $2, 'NOTIFY', $3, 'task', $4)
    `, [req.organizationId, req.user!.userId, activityMessage, taskId]);

    res.json({
      task: result[0],
      message: 'Task updated successfully'
    });

  } catch (error: any) {
    console.error('Error updating task:', error);
    res.status(500).json({ 
      message: 'Failed to update task' 
    });
  }
});

// 4. Delete task (EDITOR/OWNER/ADMIN only)
router.delete('/:projectId/tasks/:taskId', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId, taskId } = req.params;
    
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
    const canDelete = project_role === 'EDITOR' || ['OWNER', 'ADMIN'].includes(org_role);

    if (!canDelete) {
      return res.status(403).json({ 
        message: 'Only EDITOR or OWNER/ADMIN can delete tasks' 
      });
    }

    // Get task details before deletion
    const task = await executeWithRLS(req, `
      SELECT title FROM tasks 
      WHERE id = $1 AND project_id = $2 AND organization_id = $3
    `, [taskId, projectId, req.organizationId]);

    if (task.length === 0) {
      return res.status(404).json({ 
        message: 'Task not found' 
      });
    }

    // Delete task
    await executeWithRLS(req, `
      DELETE FROM tasks 
      WHERE id = $1 AND project_id = $2 AND organization_id = $3
    `, [taskId, projectId, req.organizationId]);

    // Create activity log
    await executeWithRLS(req, `
      INSERT INTO activities (organization_id, actor_id, kind, message, object_type, object_id)
      VALUES ($1, $2, 'NOTIFY', $3, 'task', $4)
    `, [req.organizationId, req.user!.userId, `${req.user!.username} deleted task "${task[0].title}"`, taskId]);

    res.json({
      message: 'Task deleted successfully',
      taskId
    });

  } catch (error: any) {
    console.error('Error deleting task:', error);
    res.status(500).json({ 
      message: 'Failed to delete task' 
    });
  }
});

// 5. Get task board (Kanban view)
router.get('/:projectId/tasks/board', setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { projectId } = req.params;
    
    // Check if user has access to project
    const hasAccess = await hasProjectAccess(req, projectId);
    if (!hasAccess) {
      return res.status(403).json({ 
        message: 'Access denied to this project' 
      });
    }

    const tasks = await executeWithRLS(req, `
      SELECT 
        t.id, t.title, t.description, t.status, t.assignee_id, 
        t.due_date, t.priority, t.order_in_board, t.created_at,
        u.username as assignee_username
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.project_id = $1 AND t.organization_id = $2
      ORDER BY t.order_in_board ASC, t.created_at DESC
    `, [projectId, req.organizationId]);

    const board = {
      todo: tasks.filter((task: any) => task.status === 'TODO'),
      inProgress: tasks.filter((task: any) => task.status === 'INPROGRESS'),
      done: tasks.filter((task: any) => task.status === 'DONE')
    };

    res.json({ board });

  } catch (error: any) {
    console.error('Error fetching task board:', error);
    res.status(500).json({ 
      message: 'Failed to fetch task board' 
    });
  }
});

export default router;
