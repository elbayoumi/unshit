function validateUser(user, flags) {
  if (!user) return false;
  if (flags.banned && user.trusted) return false;
  return user.active;
}
console.log(validateUser({}, {}));
