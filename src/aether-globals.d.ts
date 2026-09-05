export {};
declare global {
    interface Window {
        __AETHER_GET_CONTEXT_ITEMS__?: (chart: any, point: any) => any[];
        __AETHER_HANDLE_CONTEXT_ACTION__?: (actionId: string, chart: any, point: any) => boolean;
        __AETHER_SYNC_INDICATORS__?: (chart?: any) => void;
        __AETHER_777_LEVELS__?: any; __AETHER_ICT_TIME_LEVELS__?: any;
        __AETHER_ICT_LIQUIDITY_LEVELS__?: any; __AETHER_ICT_TRADE_LEVELS__?: any; __AETHER_KEY_LEVELS__?: any;
        __AETHER_VP_LEVELS__?: any; __AETHER_VP_HISTOGRAM__?: any; __AETHER_REQUEST_OVERLAY_PAINT__?: () => void;
        __AETHER_RUN_CONTEXT_ORDER__?: (actionId: string, ...rest: any[]) => boolean;
    }
}
