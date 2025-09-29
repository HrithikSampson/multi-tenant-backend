import 'reflect-metadata';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getInitializedDataSource } from '../config/database';
import { User } from '../entity/user.entity';
import logger from '../utils/logger';
import { z } from 'zod';

const router = Router();

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/^\S+$/, "Password must not contain spaces")
  .regex(/\p{Ll}/u, "Must include at least one lowercase letter")
  .regex(/\p{Lu}/u, "Must include at least one uppercase letter")
  .regex(/\p{Nd}/u, "Must include at least one digit");

const generateTokens = (userId: string, username: string) => {
  const accessToken = jwt.sign(
    { userId, username, token_use: 'access' },
    process.env.JWT_ACCESS_SECRET || 'default-access-secret-for-demo',
    { expiresIn: '15m' }
  );
  
  const refreshToken = jwt.sign(
    { userId, username, token_use: 'refresh', jti: require('crypto').randomUUID() },
    process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-for-demo',
    { expiresIn: '7d' }
  );
  
  return { accessToken, refreshToken };
};

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const checkPasswordParse = passwordSchema.safeParse(password);

    if (!checkPasswordParse.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: checkPasswordParse.error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });
    }
    
    const AppDataSource = await getInitializedDataSource();
    const userRepository = AppDataSource.getRepository(User);
    const existingUser = await userRepository.findOne({ where: { username } });
    
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    const passwordHash = await bcrypt.hash(password, 12);
    const user = userRepository.create({
      username,
      passwordHash
    });
    
    await userRepository.save(user);
    
    const { accessToken, refreshToken } = generateTokens(user.id, user.username);
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    logger.info(`User registered: ${username}`);
    
    const {id, passwordHash: passwrdHash, ...userWithoutPassword} = user;
    
    res.status(201).json({
      message: 'User created successfully',
      user: userWithoutPassword,
      accessToken
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const AppDataSource = await getInitializedDataSource();
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { username } });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const { accessToken, refreshToken } = generateTokens(user.id, user.username);
    
    logger.info(`User logged in: ${username}`);
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();

    await queryRunner.query(`SELECT set_config('app.user_id', $1, true)`, [user.id.toString()]);
    await queryRunner.release();
    
    const {passwordHash, ...userWithoutPassword} = user;
    
    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      accessToken
      // Don't send refreshToken in response body for security
    });
  } catch (error: any) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error',
      message: error.messages
     });
  }
});


// Find user by username
router.post('/find-by-username', async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    
    const AppDataSource = await getInitializedDataSource();
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { username } });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const {passwordHash, ...userWithoutPassword} = user;
    res.json({
      user: userWithoutPassword
    });
  } catch (error) {
    logger.error('Find user by username error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search users with fuzzy matching
router.post('/search-users', async (req: Request, res: Response) => {
  try {
    const { query, limit = 10 } = req.body;
    
    if (!query || query.trim().length < 2) {
      return res.json({ users: [] });
    }
    
    const AppDataSource = await getInitializedDataSource();
    const userRepository = AppDataSource.getRepository(User);
    
    // Use ILIKE for case-insensitive partial matching
    const users = await userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.username'])
      .where('user.username ILIKE :query', { query: `%${query}%` })
      .orderBy('user.username', 'ASC')
      .limit(limit)
      .getMany();
    
    res.json({
      users: users
    });
  } catch (error) {
    logger.error('Search users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ 
        code: 'missing_refresh', 
        message: 'Refresh token not found' 
      });
    }

    try {
      const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-for-demo') as any;
      
      // Verify token type
      if (payload.token_use !== 'refresh') {
        return res.status(401).json({ 
          code: 'invalid_token_type', 
          message: 'Invalid token type' 
        });
      }

      // Re-load user from database to ensure claims are current
      const AppDataSource = await getInitializedDataSource();
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({ where: { id: payload.userId } });

      if (!user) {
        return res.status(401).json({ 
          code: 'user_not_found', 
          message: 'User not found' 
        });
      }

      // Generate new access token with current user data
      const newAccessToken = jwt.sign(
        { userId: user.id, username: user.username, token_use: 'access' },
        process.env.JWT_ACCESS_SECRET || 'default-access-secret-for-demo',
        { expiresIn: '15m' }
      );

      // Set new access token in response header
      res.setHeader('Authorization', `Bearer ${newAccessToken}`);
      
      logger.info(`Token refreshed for user: ${user.username}`);
      
      return res.json({ 
        accessToken: newAccessToken,
        message: 'Token refreshed successfully' 
      });

    } catch (jwtError: any) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          code: 'refresh_expired', 
          message: 'Refresh token expired' 
        });
      }
      return res.status(401).json({ 
        code: 'invalid_refresh', 
        message: 'Invalid refresh token' 
      });
    }

  } catch (error) {
    logger.error('Refresh error:', error);
    res.status(500).json({ 
      code: 'internal_error',
      message: 'Internal server error' 
    });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (refreshToken) {
      // In a production app, you would blacklist the refresh token
      // For now, we'll just clear the cookie
      res.clearCookie('refreshToken');
      logger.info('User logged out');
    }
    
    res.json({ message: 'Logout successful' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
