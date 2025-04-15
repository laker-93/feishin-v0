import { PlaylistBuilderContent } from '/@/renderer/features/playlist-builder/components/playlist-builder-content';
import { PlaylistBuilderHeader } from '/@/renderer/features/playlist-builder/components/playlist-builder-header';
import { AnimatedPage } from '/@/renderer/features/shared';

const PlaylistBuilderRoute = () => {
    return (
        <AnimatedPage>
            <PlaylistBuilderHeader />
            <PlaylistBuilderContent />
        </AnimatedPage>
    );
};

export default PlaylistBuilderRoute;
