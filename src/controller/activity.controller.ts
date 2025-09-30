import { Router, Request, Response } from 'express';
import { getInitializedDataSource } from '../config/database';
import { Activity } from '../entity/activity.entity';
import { Organization } from '../entity/organization.entity';
import { User } from '../entity/user.entity';
import { jwtMiddleware, setOrganizationContext, requireOrganization } from '../utils/middleware/jwtMiddleWare';
import { ActivityKind } from '../db/enums';
import { getRedisActivityService } from '../services/redis-activity.service';

const router = Router();

// Get activity feed for an organization
router.get('/', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { organizationId } = req.params;
    const { page = 1, limit = 20, kind, roomKey } = req.query;
    
    const AppDataSource = await getInitializedDataSource();
    const organizationRepository = AppDataSource.getRepository(Organization);
    
    // Get organization details
    const organization = await organizationRepository.findOne({
      where: { id: organizationId }
    });
    
    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }
    
    // Use roomKey if provided, otherwise use organization's roomKey
    const targetRoomKey = roomKey || organization.roomKey;
    
    // Get activities from Redis
    console.log('ActivityController: Getting activities for roomKey:', targetRoomKey);
    const redisActivityService = getRedisActivityService();
    const { activities, total } = await redisActivityService.getActivities(
      targetRoomKey, 
      Number(page), 
      Number(limit), 
      kind as string
    );
    console.log('ActivityController: Retrieved activities:', activities.length, 'total:', total);
    
    res.json({
      activities,
      organization: {
        id: organization.id,
        name: organization.name,
        roomKey: organization.roomKey
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error: any) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ message: 'Failed to fetch activities' });
  }
});

// Create a new activity
router.post('/', jwtMiddleware as any, setOrganizationContext as any, requireOrganization as any, async (req: any, res: Response) => {
  try {
    const { organizationId } = req.params;
    const { kind, message, objectType, objectId, meta = {} } = req.body;
    
    if (!kind || !message) {
      return res.status(400).json({ message: 'Kind and message are required' });
    }
    
    if (!Object.values(ActivityKind).includes(kind)) {
      return res.status(400).json({ message: 'Invalid activity kind' });
    }
    
    const AppDataSource = await getInitializedDataSource();
    const activityRepository = AppDataSource.getRepository(Activity);
    
    const activity = activityRepository.create({
      organizationId,
      actorId: req.user!.userId,
      kind,
      message,
      objectType,
      objectId,
      meta
    });
    
    const savedActivity = await activityRepository.save(activity);
    
    // Fetch the activity with actor details
    const activityWithActor = await activityRepository
      .createQueryBuilder('activity')
      .leftJoinAndSelect('activity.actor', 'actor')
      .where('activity.id = :id', { id: savedActivity.id })
      .getOne();
    
    res.status(201).json({ activity: activityWithActor });
  } catch (error: any) {
    console.error('Error creating activity:', error);
    res.status(500).json({ message: 'Failed to create activity' });
  }
});


export default router;
