import { getInitializedDataSource } from '../config/database';
import { Activity } from '../entity/activity.entity';
import { ActivityKind } from '../db/enums';
import { getWebSocketService } from './websocket.service';
import { getRedisActivityService } from './redis-activity.service';

export class ActivityService {
  static async logActivity(
    organizationId: string,
    actorId: string,
    kind: ActivityKind,
    message: string,
    objectType?: string,
    objectId?: string,
    meta: Record<string, any> = {}
  ): Promise<Activity> {
    const AppDataSource = await getInitializedDataSource();
    
    // Get organization's roomKey (subdomain) and actor details
    const [organization, actor] = await Promise.all([
      AppDataSource.query(`SELECT room_key FROM organizations WHERE id = $1`, [organizationId]),
      AppDataSource.query(`SELECT id, username FROM users WHERE id = $1`, [actorId])
    ]);
    
    if (organization.length === 0 || actor.length === 0) {
      throw new Error('Organization or actor not found');
    }
    
    const roomKey = organization[0].room_key;
    const actorData = actor[0];
    
    // Create activity object
    const activity: Activity = {
      id: Date.now().toString(), // Simple ID for Redis
      organizationId,
      actorId,
      kind,
      message,
      objectType,
      objectId,
      meta,
      createdAt: new Date(),
      actor: {
        id: actorData.id,
        username: actorData.username
      }
    } as Activity;
    
    // Store in Redis
    console.log('ActivityService: Storing activity in Redis for roomKey:', roomKey);
    const redisActivityService = getRedisActivityService();
    await redisActivityService.storeActivity(roomKey, activity);
    console.log('ActivityService: Activity stored successfully');
    
    // Broadcast via WebSocket
    const webSocketService = getWebSocketService();
    if (webSocketService) {
      console.log('ActivityService: Broadcasting activity via WebSocket');
      webSocketService.broadcastActivity(roomKey, activity);
    } else {
      console.log('ActivityService: WebSocket service not available');
    }
    
    return activity;
  }
  
  static async logProjectActivity(
    organizationId: string,
    actorId: string,
    action: 'created' | 'updated' | 'deleted',
    projectName: string,
    projectId: string
  ): Promise<Activity> {
    const messages = {
      created: `created project "${projectName}"`,
      updated: `updated project "${projectName}"`,
      deleted: `deleted project "${projectName}"`
    };
    
    return this.logActivity(
      organizationId,
      actorId,
      ActivityKind.NOTIFY,
      messages[action],
      'project',
      projectId,
      { projectName, action }
    );
  }
  
  static async logTaskActivity(
    organizationId: string,
    actorId: string,
    action: 'created' | 'updated' | 'deleted' | 'status_changed',
    taskTitle: string,
    taskId: string,
    projectName?: string,
    oldStatus?: string,
    newStatus?: string
  ): Promise<Activity> {
    let message: string;
    let meta: Record<string, any> = { taskTitle, action };
    
    if (action === 'status_changed' && oldStatus && newStatus) {
      message = `changed task "${taskTitle}" from ${oldStatus} to ${newStatus}`;
      meta.oldStatus = oldStatus;
      meta.newStatus = newStatus;
    } else {
      const messages = {
        created: `created task "${taskTitle}"`,
        updated: `updated task "${taskTitle}"`,
        deleted: `deleted task "${taskTitle}"`,
        status_changed: `changed task "${taskTitle}"`
      };
      message = messages[action];
    }
    
    if (projectName) {
      message += ` in project "${projectName}"`;
      meta.projectName = projectName;
    }
    
    return this.logActivity(
      organizationId,
      actorId,
      ActivityKind.NOTIFY,
      message,
      'task',
      taskId,
      meta
    );
  }
  
  static async logMemberActivity(
    organizationId: string,
    actorId: string,
    action: 'added' | 'removed' | 'role_changed',
    memberUsername: string,
    memberId: string,
    role?: string,
    oldRole?: string
  ): Promise<Activity> {
    let message: string;
    const meta: Record<string, any> = { memberUsername, action };
    
    if (action === 'role_changed' && oldRole && role) {
      message = `changed ${memberUsername}'s role from ${oldRole} to ${role}`;
      meta.oldRole = oldRole;
      meta.newRole = role;
    } else {
      const messages = {
        added: `added ${memberUsername} to the organization`,
        removed: `removed ${memberUsername} from the organization`,
        role_changed: `changed ${memberUsername}'s role`
      };
      message = messages[action];
    }
    
    return this.logActivity(
      organizationId,
      actorId,
      ActivityKind.ANNOUNCE,
      message,
      'member',
      memberId,
      meta
    );
  }
  
  static async logOrganizationActivity(
    organizationId: string,
    actorId: string,
    action: 'created' | 'updated',
    organizationName: string
  ): Promise<Activity> {
    const messages = {
      created: `created organization "${organizationName}"`,
      updated: `updated organization "${organizationName}"`
    };
    
    return this.logActivity(
      organizationId,
      actorId,
      ActivityKind.ANNOUNCE,
      messages[action],
      'organization',
      organizationId,
      { organizationName, action }
    );
  }
}
