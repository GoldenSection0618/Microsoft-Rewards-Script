export interface BrowserEarnablePoints {
    desktopSearchPoints: number
    mobileSearchPoints: number
    dailySetPoints: number
    morePromotionsPoints: number
    totalEarnablePoints: number
}

export interface AppEarnablePoints {
    readToEarn: number
    checkIn: number | null
    totalEarnablePoints: number | null
}

export interface MissingSearchPoints {
    mobilePoints: number
    desktopPoints: number
    edgePoints: number
    totalPoints: number
}
