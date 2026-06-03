import path from 'node:path';

// Central path resolver. All paths derived from the project root.
// Layout per design.md §2.
export function paths(root) {
  const workspaces = path.join(root, 'Workspaces');
  const system = path.join(workspaces, '_system');
  return {
    root,
    workspaces,
    registry: path.join(workspaces, '_registry'),
    users: path.join(workspaces, '_users'),
    system,
    registryIndex: path.join(system, 'registry.index.json'),
    usersIndex: path.join(system, 'users.index.json'),
    sessionDir: path.join(system, 'session'),
    inlayDir: path.join(root, '.inlay'),
    agentsMd: path.join(root, 'AGENTS.md'),
    claudeMd: path.join(root, 'CLAUDE.md'),
    gitignore: path.join(root, '.gitignore'),
    // workspace-scoped
    wsRegistryFile: (id) => path.join(workspaces, '_registry', `${id}.json`),
    wsDir: (id) => path.join(workspaces, id),
    adrDir: (id) => path.join(workspaces, id, 'adr'),
    contextDir: (id) => path.join(workspaces, id, 'context'),
    contextPublic: (id) => path.join(workspaces, id, 'context', 'CONTEXT.md'),
    contextUsersDir: (id) => path.join(workspaces, id, 'context', 'users'),
    contextUserFile: (id, user) =>
      path.join(workspaces, id, 'context', 'users', user, 'CONTEXT.md'),
    userFile: (user) => path.join(workspaces, '_users', `${user}.json`),
    sessionFile: (sid) => path.join(system, 'session', `current.${sid}.json`),
  };
}
