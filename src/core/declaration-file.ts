/** True for TypeScript declaration files in any module flavour. */
export function isDeclarationFile(relPath: string): boolean {
  return /\.d\.[cm]?ts$/.test(relPath);
}
