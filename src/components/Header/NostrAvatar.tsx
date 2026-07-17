import { type FC , useState , useEffect, memo } from "react";
import { Avatar } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { SimplePool } from "nostr-tools";
import { defaultRelays } from "../../utils/common"

interface NostrAvatarProps {
    pubkey? : string;
}

interface Profile {
    name? : string;
    picture? : string;
}

export const NostrAvatar : FC<NostrAvatarProps> = memo(({ pubkey }) => {
    const [profile , setProfile] = useState<Profile | undefined>(undefined);

    useEffect(() => {
        if(!pubkey) return;

        let cancelled = false;
        const pool = new SimplePool();

        async function getProfile() {
            try {
                const filter = {
                    kinds: [0],
                    authors: [pubkey!],
                };
                const event = await pool.get(defaultRelays, filter);
                if (cancelled) return;
                if (event) {
                    const parsed = JSON.parse(event.content);
                    setProfile(parsed);
                }
            } catch {
                // Ignore errors from unreachable relays or malformed profile content
            }
        }

        getProfile();

        return () => {
            cancelled = true;
            pool.close(defaultRelays);
        };
    },[pubkey]);
    
    return (
        <Avatar 
            src={profile?.picture || <UserOutlined style={{ color: "var(--color-text-secondary)" }} />}
            style={{ background: "var(--color-accent-subtle)", color: "var(--color-accent)" }}
            alt={profile?.name}
        />
    )
});