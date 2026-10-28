import type { ProjectPage } from '#lib/shared/project-page.ts';
import { getJson } from './api';

export async function fetchProjectPage(): Promise<ProjectPage> {
	return (await getJson<{ page: ProjectPage }>('/api/accessory/project')).page;
}
