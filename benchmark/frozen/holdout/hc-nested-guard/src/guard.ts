type User = { role: string; active: boolean; scopes: string[]; mfa: boolean };
function authorize(user: User, action: string): boolean {
  if (user.active) {
    if (user.role === 'admin') {
      if (user.mfa || action === 'read') {
        return true;
      }
    } else {
      for (const scope of user.scopes) {
        if (scope === action && user.mfa) return true;
      }
    }
  }
  if (!user.active && user.role === 'service') return false;
  return false;
}
console.log(authorize({ role: 'admin', active: true, scopes: [], mfa: true }, 'read'));
