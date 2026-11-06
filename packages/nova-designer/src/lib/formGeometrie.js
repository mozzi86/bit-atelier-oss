// 107-05 (package boundary): the geometry kernel moved to @core/lib/formGeometrie.js, because the massing core
// (@core/lib/massing/massingModell.js) and the later 107 plans need its primitives and @core may import only @core.
// This file stays as a re-export, so every existing import of "@designer/lib/formGeometrie" keeps working.
export * from "@core/lib/formGeometrie.js";
