import {
  createContext,
  type FC,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { getInstalledNativeSignerApps } from "../signer/NIP55Signer";
import { signerManager } from "../signer/manager";
import type { NativeSignerApp } from "../signer/types";
import { isNativePlatform } from "../utils/platform";

interface ProfileProviderProps {
    children? : ReactNode;
}


export interface ProfileContextType {
    pubkey? : string;
    requestPubkey : (packageName?: string) => Promise<string | undefined>;
    loginWithNip46: (uri: string, options?: { abortSignal?: AbortSignal }) => Promise<string | undefined>;
    loginWithNsec: (nsec: string) => Promise<string | undefined>;
    createNip46ConnectUri: () => Promise<string>;
    logout : () => Promise<void>;
    isSignedIn : boolean;
    restoring: boolean;
    nativeSignerApps: NativeSignerApp[];
    loadingNativeSignerApps: boolean;
}

export interface IProfile {
    pubkey : string;
}

export const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export const ProfileProvider : FC<ProfileProviderProps> = ({ children }) => {
    const [pubkey, setPubkey] = useState<string | undefined>(undefined);
    const [restoring, setRestoring] = useState(true);
    const [nativeSignerApps, setNativeSignerApps] = useState<NativeSignerApp[]>([]);
    const [loadingNativeSignerApps, setLoadingNativeSignerApps] = useState(isNativePlatform);
    const isSignedIn = !!pubkey;

    useEffect(() => {
        const unsubscribe = signerManager.onChange((nextPubkey) => {
            setPubkey(nextPubkey);
        });

        const restoreSigner = async () => {
            try {
                const restoredPubkey = await Promise.race([
                    signerManager.restoreFromStorage(),
                    new Promise<undefined>((resolve) => {
                        setTimeout(() => resolve(undefined), 6000);
                    }),
                ]);
                setPubkey(restoredPubkey);
            } finally {
                setRestoring(false);
            }
        };

        void restoreSigner();

        return () => {
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!isNativePlatform) {
            setLoadingNativeSignerApps(false);
            return;
        }

        const loadNativeSignerApps = async () => {
            setLoadingNativeSignerApps(true);
            try {
                const apps = await getInstalledNativeSignerApps();
                setNativeSignerApps(apps);
            } catch (error) {
                console.error("Failed to load Android signer apps", error);
                setNativeSignerApps([]);
            } finally {
                setLoadingNativeSignerApps(false);
            }
        };

        void loadNativeSignerApps();
    }, []);

    const requestPubkey = async (packageName?: string) => {
        const publicKey = await signerManager.requestPubkey(packageName);
        setPubkey(publicKey);
        return publicKey;
    };

    const loginWithNip46 = async (uri: string, options?: { abortSignal?: AbortSignal }) => {
        const publicKey = await signerManager.loginWithNip46(uri, options);
        setPubkey(publicKey);
        return publicKey;
    };

    const loginWithNsec = async (nsec: string) => {
        const publicKey = await signerManager.loginWithNsec(nsec);
        setPubkey(publicKey);
        return publicKey;
    };

    const logout = async () => {
        await signerManager.logout();
        setPubkey(undefined);
    };

    return (
        <ProfileContext.Provider
            value={{
                pubkey,
                requestPubkey,
                loginWithNip46,
                loginWithNsec,
                createNip46ConnectUri: () => signerManager.createNip46ConnectUri(),
                logout,
                isSignedIn,
                restoring,
                nativeSignerApps,
                loadingNativeSignerApps,
            }}
        >
            {children}
        </ProfileContext.Provider>
    );
}
