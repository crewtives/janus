/**
 * `projectObsidianPath` minus the vault root prefix — e.g.
 * "Projects/myorg/app". Used for `path:` graph queries and FTS doc ids.
 * If the path is not under the vault, it is returned unchanged.
 */
export function relativeVaultPath(vaultRoot: string, projectObsidianPath: string): string {
  return projectObsidianPath.startsWith(vaultRoot)
    ? projectObsidianPath.slice(vaultRoot.length).replace(/^\/+/, "")
    : projectObsidianPath;
}
