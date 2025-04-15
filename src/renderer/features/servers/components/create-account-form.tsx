import { useState } from 'react';
import { Stack, Group, Checkbox, Tooltip } from '@mantine/core';
import { Button, PasswordInput, TextInput, toast } from '/@/renderer/components';
import { useForm } from '@mantine/form';
import { closeAllModals } from '@mantine/modals';
import isElectron from 'is-electron';
import { nanoid } from 'nanoid/non-secure';
import { useAuthStoreActions } from '/@/renderer/store';
import { ServerType, toServerType } from '/@/renderer/types';
import { api } from '/@/renderer/api';
import { useTranslation } from 'react-i18next';
import { fbController } from '../../../api/filebrowser/filebrowser-controller';
import { pymixController } from '/@/renderer/api/pymix/pymix-controller';

const urlConfig = JSON.parse(process.env.URL_CONFIG);
const localSettings = isElectron() ? window.electron.localSettings : null;

const userFS = isElectron() ? window.electron.userFs : null;

interface CreateAccountFormProps {
    onCancel: () => void;
}

export const CreateAccountForm = ({ onCancel }: CreateAccountFormProps) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const { addServer, setCurrentServer } = useAuthStoreActions();

    const form = useForm({
        initialValues: {
            email: '',
            legacyAuth: false,
            name: (localSettings ? localSettings.env.SERVER_NAME : window.SERVER_NAME) ?? '',
            password: '',
            savePassword: false,
            token: '',
            type:
                (localSettings
                    ? localSettings.env.SERVER_TYPE
                    : toServerType(window.SERVER_TYPE)) ?? ServerType.NAVIDROME,
            url: (localSettings ? localSettings.env.SERVER_URL : window.SERVER_URL) ?? 'https://',
            username: '',
        },
    });

    const isSubmitDisabled = !form.values.username;

    const handleSubmit = form.onSubmit(async (values) => {
        const usernameRegex = /^[a-z0-9][a-z0-9_]*$/;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!usernameRegex.test(values.username)) {
            return toast.error({
                message: t('error.invalidUsername', {
                    postProcess: 'sentenceCase',
                }),
            });
        }

        if (!emailRegex.test(values.email)) {
            return toast.error({
                message: t('error.invalidMail', {
                    postProcess: 'sentenceCase',
                }),
            });
        }

        setIsLoading(true);
        try {
            const isValidToken = await pymixController.validateToken(values.token);
            if (!isValidToken) {
                setIsLoading(false);
                return toast.error({
                    message: (
                        <>
                            The token you provided is not valid. Please get in touch on the Discord
                            server:
                            <a
                                href="https://discord.gg/mqrRbex3hs"
                                rel="noopener noreferrer"
                                target="_blank"
                            >
                                https://discord.gg/mqrRbex3hs
                            </a>
                        </>
                    ),
                });
            }

            const authFunction = api.controller.authenticate;

            if (!authFunction) {
                return toast.error({
                    message: t('error.invalidServer', { postProcess: 'sentenceCase' }),
                });
            }

            const url = `${urlConfig.url.navidrome_user}${values.username}`;

            try {
                setIsLoading(true);
                await pymixController.create({
                    body: {
                        email: values.email,
                        password: values.password,
                        token: values.token,
                        username: values.username,
                    },
                });

                let fbToken = null;
                // todo this is only valid once the user has created an account.
                // const fbUrl = 'https://browser.sub-box.net/browser';
                const fbUrl = urlConfig.url.filebrowser;
                fbToken = await fbController.authenticate(fbUrl, {
                    password: values.password,
                    username: values.username,
                });
                if (!fbToken) {
                    toast.error({
                        message: t('error.authenticationFailed', { postProcess: 'sentenceCase' }),
                    });
                } else if (userFS) {
                    await userFS.setValue('authToken', fbToken);
                }

                const data = await authFunction(
                    url,
                    {
                        legacy: values.legacyAuth,
                        password: values.password,
                        username: values.username,
                    },
                    values.type as ServerType,
                );

                if (!data) {
                    return toast.error({
                        message: t('error.authenticationFailed', { postProcess: 'sentenceCase' }),
                    });
                }

                const serverItem = {
                    credential: data.credential,
                    fbToken,
                    id: nanoid(),
                    isPublic: false,
                    name: data.username,
                    ndCredential: data.ndCredential,
                    type: values.type as ServerType,
                    url: url.replace(/\/$/, ''),
                    userId: data.userId,
                    username: data.username,
                };

                addServer(serverItem);
                setCurrentServer(serverItem);

                closeAllModals();

                toast.success({
                    message: t('form.createAccount.success', { postProcess: 'sentenceCase' }),
                });

                if (localSettings && values.savePassword) {
                    const saved = await localSettings.passwordSet(values.password, serverItem.id);
                    if (!saved) {
                        toast.error({
                            message: t('form.createAccount.error', {
                                context: 'savePassword',
                                postProcess: 'sentenceCase',
                            }),
                        });
                    }
                }
            } catch (err: any) {
                setIsLoading(false);
                return toast.error({ message: err?.message });
            }

            return setIsLoading(false);
        } catch (err: any) {
            setIsLoading(false);
            return toast.error({ message: err?.message });
        }
    });

    return (
        <form onSubmit={handleSubmit}>
            <Stack m={5}>
                <TextInput
                    label={t('form.createAccount.input', {
                        context: 'username',
                        postProcess: 'titleCase',
                    })}
                    {...form.getInputProps('username')}
                />
                <PasswordInput
                    label={t('form.createAccount.input', {
                        context: 'password',
                        postProcess: 'titleCase',
                    })}
                    {...form.getInputProps('password')}
                />
                <TextInput
                    label={t('form.createAccount.input', {
                        context: 'email',
                        postProcess: 'titleCase',
                    })}
                    {...form.getInputProps('email')}
                />
                <Tooltip
                    withArrow
                    label="Enter the token provided to you to sign up"
                >
                    <TextInput
                        label={t('form.createAccount.input', {
                            context: 'token',
                            postProcess: 'titleCase',
                        })}
                        {...form.getInputProps('token')}
                    />
                </Tooltip>
                {localSettings && form.values.type === ServerType.NAVIDROME && (
                    <Checkbox
                        label={t('form.createAccount.input', {
                            context: 'savePassword',
                            postProcess: 'titleCase',
                        })}
                        {...form.getInputProps('savePassword', {
                            type: 'checkbox',
                        })}
                    />
                )}
                <Group position="right">
                    <Button
                        variant="subtle"
                        onClick={onCancel}
                    >
                        {t('common.cancel', { postProcess: 'titleCase' })}
                    </Button>
                    <Button
                        disabled={isSubmitDisabled}
                        loading={isLoading}
                        type="submit"
                        variant="filled"
                    >
                        {t('common.ok', { postProcess: 'titleCase' })}
                    </Button>
                </Group>
            </Stack>
        </form>
    );
};
