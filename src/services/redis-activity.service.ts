import { createClient, RedisClientType } from 'redis';
import { Activity } from '../entity/activity.entity';
import { ActivityKind } from '../db/enums';

export class RedisActivityService {
  private client: RedisClientType;
  private isConnected: boolean = false;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
      this.isConnected = true;
    });

    this.client.on('disconnect', () => {
      console.log('Redis Client Disconnected');
      this.isConnected = false;
    });
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  // Store activity in Redis with proper queue behavior
  async storeActivity(roomKey: string, activity: Activity): Promise<void> {
    console.log('RedisActivityService: Connecting to Redis...');
    await this.connect();
    
    const key = `activities:${roomKey}`;
    const activityData = JSON.stringify({
      ...activity,
      createdAt: activity.createdAt.toISOString()
    });

    console.log('RedisActivityService: Storing activity with key:', key);
    console.log('RedisActivityService: Activity data:', activityData);

    // Check current length
    const currentLength = await this.client.lLen(key);
    console.log('RedisActivityService: Current list length:', currentLength);
    const maxActivities = 20;

    if (currentLength >= maxActivities) {
      console.log('RedisActivityService: List at capacity, removing oldest and adding new');
      // Remove oldest activity (rightmost) and add new one (leftmost)
      await this.client.rPop(key);
      await this.client.lPush(key, activityData);
    } else {
      console.log('RedisActivityService: Adding to list (under capacity)');
      // Just add to the beginning
      await this.client.lPush(key, activityData);
    }
    
    // Set TTL to 7 days (604800 seconds)
    await this.client.expire(key, 604800);
    console.log('RedisActivityService: Activity stored successfully');
  }

  // Get activities from Redis
  async getActivities(roomKey: string, page: number = 1, limit: number = 20, kind?: string): Promise<{
    activities: Activity[];
    total: number;
  }> {
    console.log('RedisActivityService: Getting activities for roomKey:', roomKey);
    await this.connect();
    
    const key = `activities:${roomKey}`;
    console.log('RedisActivityService: Using key:', key);
    const allActivities = await this.client.lRange(key, 0, -1);
    console.log('RedisActivityService: Raw activities from Redis:', allActivities.length);
    
    let activities: Activity[] = allActivities.map(item => {
      const parsed = JSON.parse(item);
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt)
      };
    });

    console.log('RedisActivityService: Parsed activities:', activities.length);

    // Filter by kind if specified
    if (kind && Object.values(ActivityKind).includes(kind as ActivityKind)) {
      activities = activities.filter(activity => activity.kind === kind);
      console.log('RedisActivityService: Filtered by kind:', kind, 'result:', activities.length);
    }

    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedActivities = activities.slice(startIndex, endIndex);

    console.log('RedisActivityService: Final paginated activities:', paginatedActivities.length);

    return {
      activities: paginatedActivities,
      total: activities.length
    };
  }

  // Delete activity from Redis
  async deleteActivity(roomKey: string, activityId: string): Promise<void> {
    await this.connect();
    
    const key = `activities:${roomKey}`;
    const allActivities = await this.client.lRange(key, 0, -1);
    
    // Find and remove the activity
    const filteredActivities = allActivities.filter(item => {
      const parsed = JSON.parse(item);
      return parsed.id !== activityId;
    });

    // Replace the entire list
    if (filteredActivities.length > 0) {
      await this.client.del(key);
      // Push each activity individually to avoid spread operator issues
      for (const activity of filteredActivities) {
        await this.client.lPush(key, activity);
      }
      await this.client.expire(key, 604800);
    } else {
      await this.client.del(key);
    }
  }

  // Clear all activities for a room
  async clearActivities(roomKey: string): Promise<void> {
    await this.connect();
    
    const key = `activities:${roomKey}`;
    await this.client.del(key);
  }

  // Get activity count for a room
  async getActivityCount(roomKey: string): Promise<number> {
    await this.connect();
    
    const key = `activities:${roomKey}`;
    return await this.client.lLen(key);
  }

  // Check if Redis is connected
  isRedisConnected(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
let redisActivityService: RedisActivityService | null = null;

export const getRedisActivityService = (): RedisActivityService => {
  if (!redisActivityService) {
    redisActivityService = new RedisActivityService();
  }
  return redisActivityService;
};
