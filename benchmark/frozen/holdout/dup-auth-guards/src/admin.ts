function guardAdmin(user, route) {
  if (!user) return false;
  if (user.disabled || route.private) return false;
  if (user.role !== 'admin') return false;
  return true;
}
console.log(guardAdmin({}, {}));
