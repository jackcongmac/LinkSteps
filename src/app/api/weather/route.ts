/**
 * GET /api/weather?city=beijing
 *
 * Server-side proxy for QWeather (和风天气) real-time weather API.
 * Keeps QWEATHER_API_KEY off the client bundle entirely.
 *
 * Supported cities (add more as needed):
 *   beijing  · shanghai · shenzhen · guangzhou · chengdu
 *
 * Response shape:
 *   { temp_c, pressure, text, icon_code, city }
 *
 * Cached 15 minutes via Next.js fetch revalidation — avoids hammering
 * the free-tier quota (1,000 calls/day) on every page load.
 */

import { NextRequest, NextResponse } from 'next/server';

const QWEATHER_KEY = process.env.QWEATHER_API_KEY;

// QWeather location IDs for major Chinese cities
const CITY_IDS: Record<string, string> = {
  beijing:   '101010100',
  shanghai:  '101020100',
  shenzhen:  '101280601',
  guangzhou: '101280101',
  chengdu:   '101270101',
};

export interface WeatherPayload {
  temp_c:    number;   // °C current
  temp_min:  number;   // °C today's low
  temp_max:  number;   // °C today's high
  pressure:  number;   // hPa
  text:      string;   // e.g. "晴", "多云"
  icon_code: string;   // QWeather icon code (e.g. "100")
  city:      string;   // echoed back
}

// Fallback mock data per city — used when QWeather is unavailable
const MOCK_WEATHER: Record<string, WeatherPayload> = {
  beijing:   { temp_c: 14, temp_min:  9, temp_max: 16, pressure: 1012, text: '晴',  icon_code: '100', city: 'beijing'   },
  shanghai:  { temp_c: 17, temp_min: 13, temp_max: 20, pressure: 1010, text: '多云', icon_code: '101', city: 'shanghai'  },
  shenzhen:  { temp_c: 24, temp_min: 20, temp_max: 27, pressure: 1008, text: '晴',  icon_code: '100', city: 'shenzhen'  },
  guangzhou: { temp_c: 23, temp_min: 19, temp_max: 26, pressure: 1009, text: '多云', icon_code: '101', city: 'guangzhou' },
  chengdu:   { temp_c: 16, temp_min: 11, temp_max: 18, pressure: 1006, text: '阴',  icon_code: '104', city: 'chengdu'   },
};

export async function GET(req: NextRequest) {
  const city       = (req.nextUrl.searchParams.get('city') ?? 'beijing').toLowerCase();
  const locationId = CITY_IDS[city] ?? CITY_IDS.beijing;
  const mock       = MOCK_WEATHER[city] ?? MOCK_WEATHER.beijing;

  if (!QWEATHER_KEY) {
    console.warn('[weather] QWEATHER_API_KEY not set — returning mock data');
    return NextResponse.json({ ...mock, _mock: true });
  }

  try {
    const [nowRes, dailyRes] = await Promise.all([
      fetch(
        `https://devapi.qweather.com/v7/weather/now?location=${locationId}&key=${QWEATHER_KEY}`,
        { cache: 'no-store' },
      ),
      fetch(
        `https://devapi.qweather.com/v7/weather/3d?location=${locationId}&key=${QWEATHER_KEY}`,
        { cache: 'no-store' },
      ),
    ]);

    const nowData = (await nowRes.json()) as {
      code: string;
      now?: { temp: string; pressure: string; text: string; icon: string };
    };
    const dailyData = (await dailyRes.json()) as {
      code: string;
      daily?: { tempMin: string; tempMax: string }[];
    };

    if (nowData.code !== '200' || !nowData.now) {
      console.warn(
        `[weather] QWeather returned code=${nowData.code} for city=${city}`,
        '— falling back to mock data.',
        'Common codes: 401=auth, 402=quota, 404=location, 429=rate-limit',
      );
      return NextResponse.json({ ...mock, _mock: true });
    }

    const today = dailyData.daily?.[0];
    const payload: WeatherPayload = {
      temp_c:    parseFloat(nowData.now.temp),
      temp_min:  today ? parseFloat(today.tempMin) : mock.temp_min,
      temp_max:  today ? parseFloat(today.tempMax) : mock.temp_max,
      pressure:  parseFloat(nowData.now.pressure),
      text:      nowData.now.text,
      icon_code: nowData.now.icon,
      city,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[weather] network error — falling back to mock data:', err);
    return NextResponse.json({ ...mock, _mock: true });
  }
}
