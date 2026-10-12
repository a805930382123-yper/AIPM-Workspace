// Resolve every CSS import to an empty module so component trees stay importable in Node.
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.css')) return { url: 'data:text/javascript,', format: 'module', shortCircuit: true };
  return next(specifier, context);
}
