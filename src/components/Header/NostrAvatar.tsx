import { type FC , useState , useEffect } from "react";
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

export const NostrAvatar : FC<NostrAvatarProps> = ({ pubkey }) => {
    const [profile , setProfile] = useState<Profile | undefined>(undefined);
    let pool = new SimplePool();

    async function getProfile() {
        let filter = {
            kinds: [0],
            authors : [pubkey!],
        };
        const profile = await pool.get(defaultRelays, filter);
        if(profile){
            setProfile(JSON.parse(profile.content));
        }
        pool.close(defaultRelays);
    }

    useEffect(() => {
        if(!profile && pubkey){
            getProfile();
        }
    });

    return (
        <Avatar 
            src={profile?.picture || <UserOutlined style={{ color : "black" }} />}
            alt={profile?.name}
        />
    )
}