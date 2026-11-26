type Request = { user?: string; token?: string; roles: string[]; flags: Record<string, boolean> };
function validate(req: Request): boolean {
  if (!req.user || !req.token) return false;
  if (req.roles.length === 0) return false;
  for (const role of req.roles) {
    if (role === 'admin' && req.flags.admin) return true;
  }
  if (req.flags.beta && req.flags.staff) return true;
  return false;
}
console.log(validate({ roles: [], flags: {} }));
