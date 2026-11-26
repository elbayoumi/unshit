function guardEditor(user, route) {
  if (!user) return false;
  if (user.disabled || route.private) return false;
  if (user.role !== 'editor') return false;
  return true;
}
console.log(guardEditor({}, {}));
