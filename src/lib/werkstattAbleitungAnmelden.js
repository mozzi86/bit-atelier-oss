// 89-07 (BW-09, D-BW-05): registers the workshop derivation for readers outside the designer.
//
// @core/lib/werkstattAbleitung derives the workshop zones from the saved record (werkstatt_layer +
// building programme) instead of storing a second copy; the derivation itself (tesseliere) lives in
// @designer, which @core/@ava may not import. Only the app root may — so it registers an async
// loader here. The dynamic import keeps the tessellation in its own chunk: it loads the first time
// a reader (AVA) needs zones that no workshop session put into the store.
//
// In:  nothing (side effect on import). Out: registration in @core/lib/werkstattAbleitung.
import { registriereWerkstattAbleitung } from "@core/lib/werkstattAbleitung";

registriereWerkstattAbleitung(() => import("@designer/lib/useWerkstattRehydrate").then((m) => m.werkstattZonenAusLayer));
