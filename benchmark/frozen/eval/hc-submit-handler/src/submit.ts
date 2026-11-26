type Form = { name?: string; email?: string; age: number; accepted: boolean };
const handleSubmit = (form: Form): string => {
  if (!form.name || !form.email) return 'missing';
  if (form.age < 18) {
    if (form.accepted) return 'minor-consent';
    return 'minor';
  }
  if (form.email.includes('@') && form.name.length > 2) {
    return 'ok';
  }
  for (const ch of form.email) {
    if (ch === ' ') return 'invalid';
  }
  return 'review';
};
console.log(handleSubmit({ age: 20, accepted: true }));
