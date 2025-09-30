# Multi-Tenant Task Manager - Backend

Express.js + TypeScript backend for a multi-tenant task management system. Handles authentication, authorization, and data isolation using PostgreSQL with Row Level Security.

## Running Locally

1. **Install dependencies**
   ```sh
   npm install
   ```

2. **Set up environment variables**
   
   Create a `.env` file in the backend directory:
   ```env
   PORT=4000
   
   # PostgreSQL (Supabase)
   DB_HOST=your-project.supabase.co
   DB_PORT=5432
   DB_USERNAME=postgres
   DB_PASSWORD=your-password
   DB_NAME=postgres
   DB_SSL=true
   
   # JWT Secrets
   JWT_ACCESS_SECRET=your-access-secret-here
   JWT_REFRESH_SECRET=your-refresh-secret-here
   ```

3. **Run the dev server**
   ```sh
   npm run dev
   ```
   
   The API will be available at `http://localhost:4000`

4. **Build for production**
   ```sh
   npm run build
   npm start
   ```

## How Multi-Tenancy Works

Multi-tenancy is enforced at both the application and database levels. Every user belongs to one or more organizations, and all data is scoped to organizations.

### Database-Level Isolation

The core of multi-tenancy is PostgreSQL Row Level Security (RLS). Every database query automatically filters by organization membership - you can't bypass this even if you wanted to.

**How it works:**

1. **Session Variables**
   - Every request sets PostgreSQL session variables: `app.user_id` and `app.organization_id`
   - These are set in the middleware before any database query runs

2. **RLS Policies**
   - Database policies use these session variables to filter rows
   - Example: When you query tasks, PostgreSQL automatically adds `WHERE organization_id = current_setting('app.organization_id')`

3. **Automatic Filtering**
   - You write normal queries like `SELECT * FROM tasks`
   - PostgreSQL returns only tasks from the current organization
   - No need to manually add `WHERE organization_id = ?` everywhere

### Middleware Chain

Every protected route goes through this chain:

```
Request
  → jwtMiddleware (verify access token, extract user ID)
  → setOrganizationContext (extract org ID from URL, set RLS variables)
  → requireOrganization (verify user is a member)
  → Route Handler (do the actual work)
```

**Example flow for `GET /api/organizations/7/projects`:**

1. `jwtMiddleware`: Verifies JWT, sets `req.user.userId = 15`
2. `setOrganizationContext`: Extracts `organizationId = 7` from URL, queries if user 15 is a member, sets `app.user_id = 15` and `app.organization_id = 7` in PostgreSQL
3. `requireOrganization`: Checks membership exists, continues
4. Route handler: Queries `SELECT * FROM projects` - PostgreSQL automatically filters to `organization_id = 7`

## How Authentication Works

Dual-token JWT system: short-lived access tokens + long-lived refresh tokens.

### Token Generation

**Login/Register Flow:**
1. User submits credentials
2. Backend validates (bcrypt for passwords)
3. Generate two tokens:
   - **Access token**: 15 minutes, contains `userId` and `username`
   - **Refresh token**: 7 days, contains only `userId`
4. Access token sent in response body
5. Refresh token sent as HTTP-only cookie (can't be accessed by JavaScript)

**Code:**
```typescript
const accessToken = jwt.sign({ userId, username }, JWT_ACCESS_SECRET, { expiresIn: '15m' });
const refreshToken = jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

res.cookie('refreshToken', refreshToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
});
```

### Token Verification

**Every protected request:**
1. Extract token from `Authorization: Bearer <token>` header
2. Verify with `jwt.verify(token, JWT_ACCESS_SECRET)`
3. If valid: continue, set `req.user = { userId, username }`
4. If invalid/expired: return 401

**Refresh flow:**
1. Frontend gets 401 on expired access token
2. Sends request to `/auth/refresh`
3. Backend reads `refreshToken` from cookies
4. Verifies refresh token
5. Generates new access token
6. Returns new access token to frontend

### Why HTTP-Only Cookies?

- JavaScript can't read them (prevents XSS attacks)
- Browser automatically sends them with requests
- Can only be set/modified by the server
- More secure than localStorage for long-lived tokens

## How Ownership and Permissions Work

Role-based access control where the creator becomes the owner.

### The Hierarchy

```
User
 └─> Organization (OWNER, ADMIN, or MEMBER via org_memberships)
      └─> Projects (scoped to organization)
           └─> Tasks (scoped to project)
```

### Role Permissions

**OWNER:**
- Full control over everything
- Invite/remove any member (including admins)
- Delete the organization
- Manage all projects and tasks

**ADMIN:**
- Invite/remove members (except owner)
- Manage all projects and tasks
- Can't delete the organization
- Can't remove the owner

**MEMBER:**
- View organization data
- Create projects and tasks
- Edit tasks they created or are assigned to
- Can't invite/remove members
- Can't delete projects

### How It Works in Practice

**Creating an Organization:**
```typescript
// 1. Create organization
const org = await organizationRepo.save({ name, subdomain });

// 2. Automatically create membership with OWNER role
await orgMembershipRepo.save({
  userId,
  organizationId: org.id,
  role: OrgRole.OWNER
});

// User now owns this organization
```

**Inviting Members:**
```typescript
// Only OWNER/ADMIN can do this (checked in middleware)
await orgMembershipRepo.save({
  userId: invitedUserId,
  organizationId,
  role: OrgRole.MEMBER // or ADMIN
});
```

**Accessing Data:**
```typescript
// Middleware sets RLS variables
await queryRunner.query(`SET app.user_id = '${userId}'`);
await queryRunner.query(`SET app.organization_id = '${organizationId}'`);

// Now all queries are automatically filtered
const projects = await projectRepo.find(); // Only returns projects from org
const tasks = await taskRepo.find(); // Only returns tasks from org's projects
```

### Database Policies

**Example RLS policy on tasks table:**
```sql
CREATE POLICY user_org_tasks ON tasks
  FOR ALL
  USING (
    project_id IN (
      SELECT id FROM projects
      WHERE organization_id IN (
        SELECT organization_id FROM org_memberships
        WHERE user_id = current_setting('app.user_id')::bigint
      )
    )
  );
```

This means:
- User can only see tasks from projects
- In organizations they're a member of
- Enforced at database level - can't be bypassed

## How the Activity Feed Works

Real-time activity tracking using PostgreSQL for storage and WebSockets for live updates.

### Architecture

**Storage: PostgreSQL**
- Activities stored in `activities` table
- Includes: organizationId, actorId, kind, message, objectType, objectId, meta, createdAt
- Indexed on (organizationId, createdAt) for fast queries
- Persistent - full history available

**Real-time: WebSockets (Socket.IO)**
- Each organization has a unique "room" (using the org's subdomain as room key)
- Clients join their organization's room
- New activities broadcast to all connected clients in that room

### Creating Activities

**Code flow:**
```typescript
// 1. Something happens (e.g., task created)
await ActivityService.logActivity(
  organizationId: '7',
  actorId: '15',
  kind: ActivityKind.NOTIFY,
  message: 'created task "Homepage Design"',
  objectType: 'task',
  objectId: '42'
);

// 2. Service fetches organization's roomKey and actor username
const [org, actor] = await Promise.all([
  query('SELECT room_key FROM organizations WHERE id = $1'),
  query('SELECT username FROM users WHERE id = $1')
]);

// 3. Save to PostgreSQL
const activity = await activityRepo.save({
  organizationId,
  actorId,
  kind,
  message,
  objectType,
  objectId,
  meta
});

// 4. Broadcast via WebSocket
webSocketService.broadcastActivity(org.room_key, activity);
```

### WebSocket Rooms

**Room key = organization subdomain:**
- Organization "Acme Corp" with subdomain "acme" → room key = "acme"
- All members of Acme Corp join the "acme" room
- Activities broadcast only to that room

**Connection flow:**
```typescript
// Client connects
socket.on('joinRoom', (roomKey) => {
  socket.join(roomKey);
  console.log(`User joined room: ${roomKey}`);
});

// Server broadcasts activity
io.to(roomKey).emit('newActivity', activityData);

// All clients in that room receive the event
```

### Fetching Activities

**Paginated API endpoint:**
```
GET /api/organizations/:organizationId/activities?page=1&limit=20
```

Returns:
- Activities from PostgreSQL (filtered by org via RLS)
- Ordered by createdAt DESC
- Paginated (default 20 per page)
- Can filter by `kind` (NOTIFY, WARN, ERROR)

## API Structure

All routes follow RESTful patterns with organization context in the URL.

### Route Patterns

```
Authentication:
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout

Organizations:
GET    /api/organizations
POST   /api/organizations
GET    /api/organizations/:organizationId
PATCH  /api/organizations/:organizationId
DELETE /api/organizations/:organizationId

Members:
GET    /api/organizations/:organizationId/members
POST   /api/organizations/:organizationId/members
DELETE /api/organizations/:organizationId/members/:memberId

Projects:
GET    /api/organizations/:organizationId/projects
POST   /api/organizations/:organizationId/projects
GET    /api/organizations/:organizationId/projects/:projectId
PATCH  /api/organizations/:organizationId/projects/:projectId
DELETE /api/organizations/:organizationId/projects/:projectId

Tasks:
GET    /api/organizations/:organizationId/projects/:projectId/tasks
POST   /api/organizations/:organizationId/projects/:projectId/tasks
GET    /api/organizations/:organizationId/projects/:projectId/tasks/:taskId
PATCH  /api/organizations/:organizationId/projects/:projectId/tasks/:taskId
DELETE /api/organizations/:organizationId/projects/:projectId/tasks/:taskId

Activities:
GET    /api/organizations/:organizationId/activities
POST   /api/organizations/:organizationId/activities
```

### Middleware Stack

**Protected routes use:**
1. `jwtMiddleware` - Verify JWT, extract user
2. `setOrganizationContext` - Extract org ID, set RLS variables
3. `requireOrganization` - Verify membership
4. Route handler - Do the work

**Example:**
```typescript
router.get('/',
  jwtMiddleware,
  setOrganizationContext,
  requireOrganization,
  async (req, res) => {
    // req.user.userId is available
    // req.organizationId is available
    // RLS is active - queries auto-filter by org
    const projects = await projectRepo.find();
    res.json(projects);
  }
);
```

## Tech Stack

- **Framework**: Express.js 5
- **Language**: TypeScript 5.9
- **Database**: PostgreSQL (Supabase)
- **ORM**: TypeORM 0.3
- **Authentication**: JWT (jsonwebtoken)
- **Password Hashing**: bcrypt
- **Real-time**: Socket.IO 4.8
- **Logging**: Morgan + Winston
- **Validation**: Zod

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── database.ts           # TypeORM config & RLS setup
│   ├── controller/
│   │   ├── auth.controller.ts    # Login, register, refresh
│   │   ├── organization.controller.ts
│   │   ├── project.controller.ts
│   │   ├── task.controller.ts
│   │   └── activity.controller.ts
│   ├── entity/
│   │   ├── user.entity.ts
│   │   ├── organization.entity.ts
│   │   ├── org-membership.entity.ts
│   │   ├── project.entity.ts
│   │   ├── task.entity.ts
│   │   └── activity.entity.ts
│   ├── services/
│   │   ├── activity.service.ts   # Activity logging helpers
│   │   └── websocket.service.ts  # Socket.IO setup
│   ├── utils/
│   │   └── middleware/
│   │       └── jwtMiddleware.ts  # Auth & RLS middleware
│   ├── db/
│   │   └── enums.ts              # Shared enums (roles, statuses)
│   ├── migrations/               # TypeORM migrations
│   └── index.ts                  # Express app entry point
├── Dockerfile
├── railway.toml
├── package.json
└── tsconfig.json
```

## Database Schema

**Core tables:**

```sql
users
  - id (bigserial)
  - username (unique)
  - email (unique)
  - password_hash
  - created_at

organizations
  - id (bigserial)
  - name
  - subdomain (unique)
  - room_key (unique, for WebSocket rooms)
  - created_at

org_memberships
  - id (bigserial)
  - user_id (references users)
  - organization_id (references organizations)
  - role (OWNER, ADMIN, MEMBER)
  - joined_at
  - UNIQUE(user_id, organization_id)

projects
  - id (bigserial)
  - organization_id (references organizations)
  - name
  - description
  - created_at

tasks
  - id (bigserial)
  - project_id (references projects)
  - title
  - description
  - status (TODO, IN_PROGRESS, DONE)
  - priority (LOW, MEDIUM, HIGH)
  - assigned_to (references users, nullable)
  - created_by (references users)
  - created_at
  - updated_at

activities
  - id (bigserial)
  - organization_id (references organizations)
  - actor_id (references users)
  - kind (NOTIFY, WARN, ERROR)
  - message
  - object_type (task, project, organization)
  - object_id
  - meta (jsonb)
  - created_at
```

**RLS Policies:**
- All tables have policies enforcing organization membership
- Policies use `current_setting('app.user_id')` and `current_setting('app.organization_id')`
- See `migrations/1710000000000-init.sql` for full schema

## Environment Variables

**Required:**
- `PORT` - Server port (default: 4000)
- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port
- `DB_USERNAME` - Database user
- `DB_PASSWORD` - Database password
- `DB_NAME` - Database name
- `DB_SSL` - Use SSL (true for Supabase)
- `JWT_ACCESS_SECRET` - Secret for access tokens
- `JWT_REFRESH_SECRET` - Secret for refresh tokens

**Optional:**
- `NODE_ENV` - Environment (development/production)

## Deployment

**Railway (recommended):**

1. Create a `railway.toml`:
   ```toml
   [build]
   builder = "nixpacks"
   
   [deploy]
   numReplicas = 1
   startCommand = "npm start"
   healthcheckPath = "/health"
   healthcheckTimeout = 100
   restartPolicyType = "on_failure"
   
   [[deploy.environmentVariables]]
   name = "NODE_ENV"
   value = "production"
   
   [[deploy.environmentVariables]]
   name = "NODE_OPTIONS"
   value = "--max-old-space-size=1024"
   ```

2. Push to GitHub
3. Connect to Railway
4. Add environment variables
5. Deploy

**Docker:**
```sh
docker build -t multi-tenant-backend .
docker run -p 4000:4000 --env-file .env multi-tenant-backend
```

**Note:** TypeScript compilation requires ~1GB RAM. If deploying to memory-constrained environments, compile locally and deploy the built JavaScript.

## Scripts

- `npm run dev` - Development server with auto-reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run compiled JavaScript (production)
- `npm run type-check` - Check TypeScript without compiling
- `npm run migration:generate` - Generate TypeORM migration
- `npm run migration:run` - Run pending migrations

## Security Features

1. **Row Level Security**: Database-enforced data isolation
2. **JWT Authentication**: Stateless token-based auth
3. **HTTP-only Cookies**: Refresh tokens can't be accessed by JavaScript
4. **CORS**: Whitelist of allowed origins
5. **bcrypt**: Password hashing with salt rounds
6. **Input Validation**: Zod schemas for request validation
7. **SQL Injection Prevention**: TypeORM parameterized queries
8. **Session Variables**: RLS context set per request

## Notes

- All timestamps are `timestamptz` (timezone-aware)
- IDs are `bigserial` (64-bit integers)
- The app uses Supabase (cloud PostgreSQL) by default
- WebSocket connections are established per-organization
- Activities are indexed for fast querying (org_id + created_at)
- The `/health` endpoint is public for deployment health checks
