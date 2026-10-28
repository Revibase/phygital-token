import { OpenScreen } from '#lib/components/app/OpenScreen';
import { readBrowseLink } from '#lib/shared/browse-link.ts';

export default async function Page({ params }: { params: Promise<{ url?: string[] }> }) {
	const { url } = await params;
	return <OpenScreen target={readBrowseLink(url)} />;
}
