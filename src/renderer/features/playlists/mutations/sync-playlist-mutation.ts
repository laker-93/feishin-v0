import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { queryKeys } from '/@/renderer/api/query-keys';
import { SyncPlaylistArgs, SyncPlaylistResponse } from '/@/renderer/api/types';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { useCurrentServer } from '/@/renderer/store';
import { pymixController } from '/@/renderer/api/pymix/pymix-controller';

export const useSyncPlaylists = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();
    const server = useCurrentServer();

    return useMutation<
        SyncPlaylistResponse,
        AxiosError,
        Omit<SyncPlaylistArgs, 'server' | 'apiClientProps'>,
        null
    >({
        mutationFn: (args) => {
            return pymixController.syncPlaylists(args);
        },
        onMutate: () => {
            queryClient.cancelQueries(queryKeys.playlists.list(server?.id || ''));
            return null;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(queryKeys.playlists.list(server?.id || ''));
        },
        ...options,
    });
};
