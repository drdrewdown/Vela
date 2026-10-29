// The indicator picker's sections for the built-in catalog. A section is display text: a
// message follows the chart's language.
import { msg } from '../i18n/message';

export const INDICATOR_CATEGORIES = {
    movingAverages: msg('indicator.category.movingAverages', 'Moving Averages'),
    bands: msg('indicator.category.bands', 'Bands & Channels'),
    oscillators: msg('indicator.category.oscillators', 'Oscillators'),
    trend: msg('indicator.category.trend', 'Trend'),
    volatility: msg('indicator.category.volatility', 'Volatility'),
    volume: msg('indicator.category.volume', 'Volume'),
    overlays: msg('indicator.category.overlays', 'Overlays'),
};
