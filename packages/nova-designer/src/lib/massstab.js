// Re-export (107-12 Task 2): the working-scale helpers moved to @core/lib/plan/massstab.js (package boundary — the view state of
// @core needs detailgradFuer, and @core may import only @core). This file stays so every existing import keeps working; it is a move,
// not a merge. New code imports from @core/lib/plan/massstab.js.
//
// In: nothing. Out: the same exports as before the move (plus detailgradFuer).
export * from "@core/lib/plan/massstab.js";
