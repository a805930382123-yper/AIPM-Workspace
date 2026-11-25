export function withoutInheritedEmbeddings(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^EMBEDDING_/iu.test(name)));
}
