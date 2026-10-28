import type { ProjectApp } from '#lib/shared/project-apps.ts';
import { getJson } from './api';

export async function fetchAccessoryApps(): Promise<ProjectApp[]> {
	return (await getJson<{ apps: ProjectApp[] }>('/api/accessory/apps')).apps;
}
