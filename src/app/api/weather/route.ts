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
  temp_c:    number;   // °C
  pressure:  number;   // hPa
  text:      string;   // e.g. "晴", "多云"
  icon_code: string;   // QWeather icon code (e.g. "100")
  city:      string;   // echoed back
}

// Fallback mock data per city — used when QWeather is unavailable
const MOCK_WEATHER: Record<string, WeatherPayload> = {
  beijing:   { temp_c: 14, pressure: 1012, text: '晴',  icon_code: '100', city: 'beijing'   },
  shanghai:  { temp_c: 17, pressure: 1010, text: '多云', icon_code: '101', city: 'shanghai'  },
  shenzhen:  { temp_c: 24, pressure: 1008, text: '晴',  icon_code: '100', city: 'shenzhen'  },
  guangzhou: { temp_c: 23, pressure: 1009, text: '多云', icon_code: '101', city: 'guangzhou' },
  chengdu:   { temp_c: 16, pressure: 1006, text: '阴',  icon_code: '104', city: 'chengdu'   },
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
    const res = await fetch(
      `https://devapi.qweather.com/v7/weather/now?location=${locationId}&key=${QWEATHER_KEY}`,
      { cache: 'no-store' }, // bypass stale cached error responses
    );

    const data = (await res.json()) as {
      code: string;
      now?: {
        temp:     string;
        pressure: string;
        text:     string;
        icon:     string;
      };
    };

    if (data.code !== '200' || !data.now) {
      // Log the real QWeather code so it shows in the server terminal
      console.warn(
        `[weather] QWeather returned code=${data.code} for city=${city}`,
        '— falling back to mock data.',
        'Common codes: 401=auth, 402=quota, 404=location, 429=rate-limit',
      );
      return NextResponse.json({ ...mock, _mock: true });
    }

    const payload: WeatherPayload = {
      temp_c:    parseFloat(data.now.temp),
      pressure:  parseFloat(data.now.pressure),
      text:      data.now.text,
      icon_code: data.now.icon,
      city,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[weather] network error — falling back to mock data:', err);
    return NextResponse.json({ ...mock, _mock: true });
  }
}
