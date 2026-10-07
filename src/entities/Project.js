// Legacy-style entity import: `import { Project } from "@/entities/Project"`.
// Re-exports the Project entity client from the local bitApi client.
import { bitApi } from '@core/api/bitApi';

export const Project = bitApi.entities.Project;
export default Project;
