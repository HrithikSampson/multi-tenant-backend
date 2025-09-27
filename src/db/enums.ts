export enum OrgRole { 
  OWNER = 'OWNER', 
  ADMIN = 'ADMIN', 
  USER = 'USER' 
}

export enum ProjectRole { 
  EDITOR = 'EDITOR', 
  VIEWER = 'VIEWER' 
}

export enum TaskStatus { 
  TODO = 'TODO', 
  INPROGRESS = 'INPROGRESS', 
  DONE = 'DONE' 
}

export enum ActivityKind { 
  WARN = 'WARN', 
  ALERT = 'ALERT', 
  NOTIFY = 'NOTIFY', 
  ANNOUNCE = 'ANNOUNCE', 
  SHOW = 'SHOW' 
}
