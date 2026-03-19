import { useContext } from "react";
import { ProfileContext , type ProfileContextType } from "../Provider/ProfileProvider";

export const useProfileContext = (): ProfileContextType  => {
    const context = useContext(ProfileContext);
    if(!context) {
        throw new Error("useProfileContext must be used within a ProfileProvider");
    }
    return context;
}

export default ProfileContext;