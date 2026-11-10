/* ═══════════════════════════════════════════════════════════════
   ספידומטר — cars-core.js · ליבה משותפת למאגר הרכבים (v1, 27.10.2026)
   window.SPCars: טעינת נתונים (Supabase → cars.json → גיבוי מוטמע),
   נרמול יצרנים וסוג הנעה, כרטיס רכב אחיד, ומנגנון השוואה (סרגל + מסך).
   לא נוגע במערכת האדמין, בטבלאות או בתהליך העלאת המפרטים.
   כלל ברזל: נתון חסר לא מוצג. אין אפסים, אין ברירות מחדל, אין המצאות.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SB_URL = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
  const SB_KEY = 'sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi';

  /* תמונות סטוק כלליות (Unsplash) אינן תמונות של הדגם עצמו — במאגר אותה תמונה
     משמשת לכמה דגמים שונים. לכן מוצגת במקומן צללית נקייה, עד שתועלה תמונה אמיתית
     דרך האדמין. להחזרת המצב הקודם: false. */
  const HIDE_STOCK_IMAGES = true;
  const STOCK_HOSTS = ['images.unsplash.com', 'unsplash.com', 'images.pexels.com', 'pixabay.com'];

  const MAX_COMPARE = 4;
  const CMP_KEY = 'sp_compare_v1';

  /* ── גיבוי אחרון: 26 הרכבים האמיתיים מהמאגר (יוצא 27.10.2026). ללא ציונים או סרטונים. ── */
  const FALLBACK_CARS = [{"slug":"jaecoo-j7-phev-2025","brand":"Jaecoo","model":"J7 PHEV","year":2025,"category":"קרוסאובר","sales_rank":1,"price":189990,"price_top":202990,"engine":"1.5L טורבו + חשמל (PHEV)","horsepower":197,"torque":29.6,"acceleration_0_100":7.8,"top_speed":200,"range_ev":91,"fuel_consumption":"1.5","transmission":"DCT 7 הילוכים","drive_type":"הנעה כפולה AWD","trunk_volume":412,"weight":1860,"length":4500,"width":1865,"height":1680,"image_main":"https://kaykrrnmykqrfhawgtqt.supabase.co/storage/v1/object/public/car-photos/photos/1790335893720-iq9pyd.webp","safety_rating":null,"battery_capacity_kwh":null,"views":5,"gallery_images":["https://kaykrrnmykqrfhawgtqt.supabase.co/storage/v1/object/public/car-photos/photos/1790335893720-iq9pyd.webp"]},{"slug":"hyundai-kona-2025","brand":"Hyundai","model":"קונה","year":2025,"category":"קרוסאובר קומפקטי","sales_rank":2,"price":164990,"price_top":209990,"engine":"1.6L היברידי","horsepower":139,"torque":27,"acceleration_0_100":10.9,"top_speed":175,"range_ev":null,"fuel_consumption":"5.4","transmission":"DCT 6 הילוכים","drive_type":"קידמי","trunk_volume":466,"weight":1495,"length":4355,"width":1825,"height":1590,"image_main":"https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1200&q=80&fm=webp","safety_rating":"4 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":1,"gallery_images":["https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1200&q=80&fm=webp"]},{"slug":"hyundai-elantra-hybrid-2025","brand":"Hyundai","model":"אלנטרה היברידית","year":2025,"category":"סדאן","sales_rank":3,"price":169990,"price_top":214990,"engine":"1.6L היברידי","horsepower":139,"torque":27,"acceleration_0_100":11.2,"top_speed":180,"range_ev":null,"fuel_consumption":"4.8","transmission":"DCT 6 הילוכים","drive_type":"קידמי","trunk_volume":474,"weight":1390,"length":4675,"width":1825,"height":1415,"image_main":"https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי NHTSA","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&fm=webp"]},{"slug":"byd-atto3-2025","brand":"BYD","model":"Atto 3","year":2025,"category":"קרוסאובר חשמלי","sales_rank":4,"price":171500,"price_top":178990,"engine":"חשמלי — 150 קוט\"ש","horsepower":204,"torque":31.6,"acceleration_0_100":7.3,"top_speed":160,"range_ev":480,"fuel_consumption":null,"transmission":"אוטומטית חשמלית","drive_type":"קידמי","trunk_volume":440,"weight":1750,"length":4455,"width":1875,"height":1615,"image_main":"https://images.unsplash.com/photo-1593941707882-a5bba14938c7?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1593941707882-a5bba14938c7?w=1200&q=80&fm=webp"]},{"slug":"toyota-corolla-cross-2025","brand":"Toyota","model":"קורולה קרוס","year":2025,"category":"קרוסאובר","sales_rank":5,"price":179990,"price_top":222990,"engine":"1.8L היברידי","horsepower":140,"torque":14.5,"acceleration_0_100":8.1,"top_speed":180,"range_ev":null,"fuel_consumption":"4.5","transmission":"CVT אוטומטית","drive_type":"קידמי","trunk_volume":440,"weight":1440,"length":4460,"width":1825,"height":1620,"image_main":"https://images.unsplash.com/photo-1546614042-7df3c24c9e5d?w=1200&q=80&fm=webp","safety_rating":"Toyota Safety Sense 3.0","battery_capacity_kwh":null,"views":3,"gallery_images":["https://images.unsplash.com/photo-1546614042-7df3c24c9e5d?w=1200&q=80&fm=webp"]},{"slug":"skoda-octavia-2025","brand":"Skoda","model":"אוקטביה","year":2025,"category":"ליפטבק משפחתי","sales_rank":6,"price":164490,"price_top":266990,"engine":"1.5L TSI טורבו","horsepower":150,"torque":25.5,"acceleration_0_100":8.1,"top_speed":222,"range_ev":null,"fuel_consumption":"6.0","transmission":"DSG 7 הילוכים","drive_type":"קידמי","trunk_volume":600,"weight":1380,"length":4689,"width":1829,"height":1466,"image_main":"https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&fm=webp","safety_rating":null,"battery_capacity_kwh":null,"views":3,"gallery_images":["https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&fm=webp"]},{"slug":"chery-tiggo8pro-2025","brand":"Chery","model":"טיגו 8 פרו","year":2025,"category":"SUV משפחתי 7 מקומות","sales_rank":7,"price":169990,"price_top":199990,"engine":"1.6L טורבו","horsepower":197,"torque":29.6,"acceleration_0_100":8.5,"top_speed":205,"range_ev":null,"fuel_consumption":"8.5","transmission":"DCT 7 הילוכים","drive_type":"קידמי","trunk_volume":295,"weight":1810,"length":4722,"width":1860,"height":1745,"image_main":"https://images.unsplash.com/photo-1585011664466-b7bbe92f34ef?w=1200&q=80&fm=webp","safety_rating":null,"battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1585011664466-b7bbe92f34ef?w=1200&q=80&fm=webp"]},{"slug":"toyota-yaris-cross-2025","brand":"Toyota","model":"יאריס קרוס","year":2025,"category":"קרוסאובר קומפקטי","sales_rank":8,"price":149990,"price_top":189990,"engine":"1.5L היברידי","horsepower":116,"torque":14.4,"acceleration_0_100":11.2,"top_speed":170,"range_ev":null,"fuel_consumption":"4.3","transmission":"CVT אוטומטית","drive_type":"קידמי / AWD","trunk_volume":397,"weight":1270,"length":4180,"width":1765,"height":1590,"image_main":"https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":0,"gallery_images":["https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&fm=webp"]},{"slug":"kia-sportage-hybrid-2025","brand":"Kia","model":"ספורטאז' היברידי","year":2025,"category":"קרוסאובר","sales_rank":9,"price":174990,"price_top":229990,"engine":"1.6L היברידי","horsepower":230,"torque":35.7,"acceleration_0_100":8,"top_speed":193,"range_ev":null,"fuel_consumption":"6.1","transmission":"DCT 6 הילוכים","drive_type":"הנעה כפולה AWD","trunk_volume":543,"weight":1710,"length":4515,"width":1865,"height":1645,"image_main":"https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":0,"gallery_images":["https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=1200&q=80&fm=webp"]},{"slug":"kia-picanto-2025","brand":"Kia","model":"פיקנטו","year":2025,"category":"מיני עירוני","sales_rank":10,"price":71990,"price_top":91990,"engine":"1.0L / 1.2L טבעי","horsepower":67,"torque":9.8,"acceleration_0_100":14.5,"top_speed":155,"range_ev":null,"fuel_consumption":"5.2","transmission":"ידנית 5 הילוכים / AMT אוטומטית","drive_type":"קידמי","trunk_volume":255,"weight":960,"length":3595,"width":1595,"height":1485,"image_main":"https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&fm=webp","safety_rating":null,"battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&fm=webp"]},{"slug":"mitsubishi-outlander-2025","brand":"Mitsubishi","model":"אאוטלנדר","year":2025,"category":"SUV משפחתי 7 מקומות","sales_rank":11,"price":189990,"price_top":239990,"engine":"2.5L + חשמל (PHEV) / 2.5L טבעי","horsepower":188,"torque":26,"acceleration_0_100":10.5,"top_speed":200,"range_ev":83,"fuel_consumption":"2.0","transmission":"CVT אוטומטית","drive_type":"הנעה כפולה AWD","trunk_volume":463,"weight":2030,"length":4710,"width":1860,"height":1745,"image_main":"https://images.unsplash.com/photo-1561580125-028ee3bd62eb?w=1200&q=80&fm=webp","safety_rating":null,"battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1561580125-028ee3bd62eb?w=1200&q=80&fm=webp"]},{"slug":"toyota-rav4-hybrid-2025","brand":"Toyota","model":"RAV4 היברידי","year":2025,"category":"קרוסאובר מידי","sales_rank":12,"price":219990,"price_top":269990,"engine":"2.5L היברידי","horsepower":222,"torque":22.5,"acceleration_0_100":8.1,"top_speed":180,"range_ev":null,"fuel_consumption":"5.8","transmission":"CVT אוטומטית","drive_type":"הנעה כפולה AWD-i","trunk_volume":580,"weight":1790,"length":4600,"width":1855,"height":1685,"image_main":"https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=1200&q=80&fm=webp"]},{"slug":"byd-seal-u-2025","brand":"BYD","model":"Seal U","year":2025,"category":"קרוסאובר חשמלי","sales_rank":13,"price":174990,"price_top":194990,"engine":"חשמלי — 150 קוט\"ש","horsepower":204,"torque":31.6,"acceleration_0_100":7.9,"top_speed":175,"range_ev":420,"fuel_consumption":null,"transmission":"אוטומטית חשמלית","drive_type":"קידמי","trunk_volume":425,"weight":1940,"length":4785,"width":1890,"height":1668,"image_main":"https://images.unsplash.com/photo-1617788138017-80ad40651399?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1617788138017-80ad40651399?w=1200&q=80&fm=webp"]},{"slug":"mg-hs-hybrid-2025","brand":"MG","model":"HS היברידי","year":2025,"category":"קרוסאובר","sales_rank":14,"price":149990,"price_top":179990,"engine":"1.5L טורבו + חשמל (PHEV)","horsepower":258,"torque":37.7,"acceleration_0_100":6.9,"top_speed":200,"range_ev":60,"fuel_consumption":"1.9","transmission":"DCT 7 הילוכים","drive_type":"קידמי","trunk_volume":507,"weight":1830,"length":4655,"width":1876,"height":1664,"image_main":"https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":3,"gallery_images":["https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=1200&q=80&fm=webp"]},{"slug":"xpeng-g6-2025","brand":"Xpeng","model":"G6","year":2025,"category":"קרוסאובר חשמלי","sales_rank":15,"price":179990,"price_top":209990,"engine":"חשמלי — 226 קוט\"ש","horsepower":308,"torque":44.9,"acceleration_0_100":5.9,"top_speed":200,"range_ev":570,"fuel_consumption":null,"transmission":"אוטומטית חשמלית","drive_type":"הנעה כפולה AWD","trunk_volume":571,"weight":2060,"length":4753,"width":1920,"height":1650,"image_main":"https://images.unsplash.com/photo-1536700503339-1e771d4360f7?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1536700503339-1e771d4360f7?w=1200&q=80&fm=webp"]},{"slug":"mazda-cx5-2025","brand":"Mazda","model":"CX-5","year":2025,"category":"קרוסאובר","sales_rank":16,"price":167990,"price_top":229990,"engine":"2.5L טורבו / 2.0L טבעי","horsepower":227,"torque":42.8,"acceleration_0_100":7,"top_speed":200,"range_ev":null,"fuel_consumption":"8.2","transmission":"אוטומטית 6 הילוכים","drive_type":"הנעה כפולה AWD","trunk_volume":506,"weight":1624,"length":4550,"width":1842,"height":1680,"image_main":"https://images.unsplash.com/photo-1546614042-7df3c24c9e5d?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1546614042-7df3c24c9e5d?w=1200&q=80&fm=webp"]},{"slug":"hyundai-tucson-hybrid-2025","brand":"Hyundai","model":"טוסון היברידי","year":2025,"category":"קרוסאובר","sales_rank":17,"price":189990,"price_top":234990,"engine":"1.6L טורבו + היברידי","horsepower":230,"torque":35.7,"acceleration_0_100":7.9,"top_speed":193,"range_ev":null,"fuel_consumption":"6.3","transmission":"DCT 6 הילוכים","drive_type":"הנעה כפולה AWD","trunk_volume":558,"weight":1730,"length":4500,"width":1865,"height":1650,"image_main":"https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":0,"gallery_images":["https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&fm=webp"]},{"slug":"toyota-chr-2025","brand":"Toyota","model":"C-HR","year":2025,"category":"קרוסאובר קומפקטי","sales_rank":18,"price":169990,"price_top":219990,"engine":"1.8L / 2.0L היברידי","horsepower":140,"torque":14.5,"acceleration_0_100":8.2,"top_speed":180,"range_ev":null,"fuel_consumption":"4.8","transmission":"CVT אוטומטית","drive_type":"קידמי / AWD-i","trunk_volume":388,"weight":1435,"length":4360,"width":1820,"height":1565,"image_main":"https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&fm=webp"]},{"slug":"skoda-kamiq-2025","brand":"Skoda","model":"קאמיק","year":2025,"category":"קרוסאובר קומפקטי","sales_rank":19,"price":129990,"price_top":169990,"engine":"1.0L / 1.5L TSI טורבו","horsepower":115,"torque":20.4,"acceleration_0_100":10.5,"top_speed":192,"range_ev":null,"fuel_consumption":"5.8","transmission":"DSG 7 הילוכים","drive_type":"קידמי","trunk_volume":400,"weight":1280,"length":4241,"width":1793,"height":1576,"image_main":"https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1200&q=80&fm=webp"]},{"slug":"seat-arona-2025","brand":"SEAT","model":"ארונה","year":2025,"category":"קרוסאובר קומפקטי","sales_rank":20,"price":124990,"price_top":159990,"engine":"1.0L / 1.5L TSI טורבו","horsepower":110,"torque":20.4,"acceleration_0_100":10.9,"top_speed":188,"range_ev":null,"fuel_consumption":"5.7","transmission":"DSG 7 הילוכים","drive_type":"קידמי","trunk_volume":400,"weight":1226,"length":4138,"width":1780,"height":1552,"image_main":"https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&fm=webp"]},{"slug":"toyota-corolla-hybrid-2025","brand":"Toyota","model":"קורולה היברידית","year":2025,"category":"סדאן","sales_rank":21,"price":159990,"price_top":194990,"engine":"1.8L / 2.0L היברידי","horsepower":140,"torque":14.5,"acceleration_0_100":9.2,"top_speed":180,"range_ev":null,"fuel_consumption":"4.4","transmission":"CVT אוטומטית","drive_type":"קידמי","trunk_volume":361,"weight":1380,"length":4620,"width":1780,"height":1435,"image_main":"https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1200&q=80&fm=webp"]},{"slug":"subaru-crosstrek-2025","brand":"Subaru","model":"קרוסטרק","year":2025,"category":"קרוסאובר","sales_rank":22,"price":179990,"price_top":214990,"engine":"2.0L היברידי קל (e-Boxer)","horsepower":150,"torque":19.8,"acceleration_0_100":11,"top_speed":192,"range_ev":null,"fuel_consumption":"6.5","transmission":"Lineatronic CVT","drive_type":"הנעה כפולה Symmetrical AWD","trunk_volume":385,"weight":1565,"length":4480,"width":1800,"height":1575,"image_main":"https://images.unsplash.com/photo-1585011664466-b7bbe92f34ef?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1585011664466-b7bbe92f34ef?w=1200&q=80&fm=webp"]},{"slug":"kia-niro-hybrid-2025","brand":"Kia","model":"נירו היברידי","year":2025,"category":"קרוסאובר קומפקטי","sales_rank":23,"price":154990,"price_top":194990,"engine":"1.6L היברידי","horsepower":141,"torque":27,"acceleration_0_100":11,"top_speed":162,"range_ev":null,"fuel_consumption":"4.9","transmission":"DCT 6 הילוכים","drive_type":"קידמי","trunk_volume":451,"weight":1505,"length":4420,"width":1825,"height":1570,"image_main":"https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=1200&q=80&fm=webp","safety_rating":"4 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=1200&q=80&fm=webp"]},{"slug":"volkswagen-tiguan-2025","brand":"Volkswagen","model":"טיגואן","year":2025,"category":"קרוסאובר","sales_rank":24,"price":189990,"price_top":259990,"engine":"1.5L eTSI מיילד-היברידי","horsepower":150,"torque":25.5,"acceleration_0_100":9,"top_speed":200,"range_ev":null,"fuel_consumption":"6.5","transmission":"DSG 7 הילוכים","drive_type":"קידמי / 4Motion AWD","trunk_volume":652,"weight":1620,"length":4539,"width":1842,"height":1661,"image_main":"https://images.unsplash.com/photo-1555215695-3004980ad54e?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":2,"gallery_images":["https://images.unsplash.com/photo-1555215695-3004980ad54e?w=1200&q=80&fm=webp"]},{"slug":"mg3-hybrid-2026","brand":"MG","model":"MG3 היברידי","year":2026,"category":"הטצ'בק קומפקטי","sales_rank":25,"price":99990,"price_top":119990,"engine":"1.5L + חשמל (היברידי מלא)","horsepower":194,"torque":25.5,"acceleration_0_100":7.5,"top_speed":185,"range_ev":null,"fuel_consumption":"4.4","transmission":"DCT 6 הילוכים","drive_type":"קידמי","trunk_volume":293,"weight":1340,"length":4113,"width":1809,"height":1504,"image_main":"https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&fm=webp","safety_rating":"5 כוכבי Euro NCAP","battery_capacity_kwh":null,"views":3,"gallery_images":["https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&fm=webp"]},{"slug":"chery-tiggo-9-pro-phev-2026","brand":"CHERY","model":"Tiggo 9 Pro PHEV","year":2026,"category":"רכב פנאי שטח 7 מקומות ישיבה","sales_rank":null,"price":217990,"price_top":244990,"engine":"מנוע בנזין 1.5 טורבו (143 כ״ס) + מנועים חשמליים קדמיים (102 כ״ס ו-122.4 כ״ס)","horsepower":422,"torque":59,"acceleration_0_100":8.9,"top_speed":180,"range_ev":75,"fuel_consumption":"0.5 ל'/100 ק\"מ","transmission":"אוטומטית 3DHT","drive_type":"קדמית","trunk_volume":143,"weight":2722,"length":4810,"width":1925,"height":1741,"image_main":"https://kaykrrnmykqrfhawgtqt.supabase.co/storage/v1/object/public/car-photos/photos/1790336316898-yvadc5.webp","safety_rating":"רמת בטיחות 6 מתוך 8","battery_capacity_kwh":18.3,"views":9,"gallery_images":["https://kaykrrnmykqrfhawgtqt.supabase.co/storage/v1/object/public/car-photos/photos/1790336316898-yvadc5.webp"]}];

  /* ── יצרנים: שם קנוני + שם עברי + איותים חלופיים לחיפוש ── */
  const BRANDS = {
    toyota:{name:'Toyota',he:'טויוטה',alt:['טויוטה','טיוטה']},
    hyundai:{name:'Hyundai',he:'יונדאי',alt:['יונדאי','היונדאי','יונדי']},
    kia:{name:'Kia',he:'קיה',alt:['קיה','קיא']},
    skoda:{name:'Skoda',he:'סקודה',alt:['סקודה','שקודה']},
    byd:{name:'BYD',he:'BYD',alt:['ביוואידי','בי וואי די','בי.וואי.די','בי-וואי-די']},
    chery:{name:'Chery',he:"צ'רי",alt:["צ'רי",'צרי','צ׳רי','cherry']},
    jaecoo:{name:'Jaecoo',he:"ג'יקו",alt:["ג'יקו",'גייקו','ג׳יקו','jeacoo']},
    mitsubishi:{name:'Mitsubishi',he:'מיצובישי',alt:['מיצובישי','מיצובשי']},
    mg:{name:'MG',he:"אם ג'י",alt:["אם ג'י",'אמג׳י','אם גי','מג']},
    xpeng:{name:'Xpeng',he:'אקספנג',alt:['אקספנג','איקספנג','xpeng']},
    mazda:{name:'Mazda',he:'מאזדה',alt:['מאזדה','מזדה']},
    subaru:{name:'Subaru',he:'סובארו',alt:['סובארו','סוברו']},
    seat:{name:'SEAT',he:'סיאט',alt:['סיאט','סאט']},
    volkswagen:{name:'Volkswagen',he:'פולקסווגן',alt:['פולקסווגן','פולקסוואגן','vw','פולקס']},
    cupra:{name:'Cupra',he:'קופרה',alt:['קופרה']},
    tesla:{name:'Tesla',he:'טסלה',alt:['טסלה']},
    bmw:{name:'BMW',he:'ב.מ.וו',alt:['במוו','ב.מ.וו','בי אם דבליו']},
    mercedes:{name:'Mercedes-Benz',he:'מרצדס',alt:['מרצדס','mercedes','benz']},
    nissan:{name:'Nissan',he:'ניסאן',alt:['ניסאן','ניסן']},
    peugeot:{name:'Peugeot',he:"פיג'ו",alt:["פיג'ו",'פיגו']},
    renault:{name:'Renault',he:'רנו',alt:['רנו']},
    geely:{name:'Geely',he:"ג'ילי",alt:["ג'ילי",'גילי']},
    leapmotor:{name:'Leapmotor',he:'ליפמוטור',alt:['ליפמוטור']},
    exeed:{name:'Exeed',he:'אקסיד',alt:['אקסיד']},
    audi:{name:'Audi',he:'אאודי',alt:['אאודי','אודי']},
    lexus:{name:'Lexus',he:'לקסוס',alt:['לקסוס']},
    volvo:{name:'Volvo',he:'וולוו',alt:['וולוו','וולבו']},
    ford:{name:'Ford',he:'פורד',alt:['פורד']},
    jeep:{name:'Jeep',he:"ג'יפ",alt:["ג'יפ",'גיפ']},
    suzuki:{name:'Suzuki',he:'סוזוקי',alt:['סוזוקי']},
    honda:{name:'Honda',he:'הונדה',alt:['הונדה']},
    citroen:{name:'Citroën',he:'סיטרואן',alt:['סיטרואן','citroen']},
    opel:{name:'Opel',he:'אופל',alt:['אופל']},
    dacia:{name:'Dacia',he:"דאצ'יה",alt:["דאצ'יה",'דציה']},
    porsche:{name:'Porsche',he:'פורשה',alt:['פורשה']},
    mini:{name:'MINI',he:'מיני',alt:['מיני']},
    landrover:{name:'Land Rover',he:'לנד רובר',alt:['לנד רובר','ריינג רובר','range rover']},
    genesis:{name:'Genesis',he:'ג׳נסיס',alt:["ג'נסיס",'גנסיס']},
    polestar:{name:'Polestar',he:'פולסטאר',alt:['פולסטאר']},
    zeekr:{name:'Zeekr',he:'זיקר',alt:['זיקר']},
    lynkco:{name:'Lynk & Co',he:'לינק אנד קו',alt:['לינק']},
    omoda:{name:'Omoda',he:'אומודה',alt:['אומודה']},
    smart:{name:'smart',he:'סמארט',alt:['סמארט']},
    alfaromeo:{name:'Alfa Romeo',he:'אלפא רומיאו',alt:['אלפא רומיאו','אלפא']},
    fiat:{name:'Fiat',he:'פיאט',alt:['פיאט']},
    ds:{name:'DS',he:'DS',alt:[]},
    gwm:{name:'GWM',he:'GWM',alt:['ORA','אורה','גרייט וול']},
    lucid:{name:'Lucid',he:'לוסיד',alt:['לוסיד']},
    kgm:{name:'KGM',he:'KGM',alt:['סאנגיונג','ssangyong']}
  };
  /* כל המותגים שנמכרים בישראל — לשורת הסמלים ולעמוד "כל המותגים".
     מותג בלי דגמים במאגר מוצג עם "בקרוב". הסדר: לפי מספר הדגמים במאגר, אחר כך לפי הרשימה. */
  const BRAND_ORDER = ['toyota','hyundai','kia','skoda','byd','chery','jaecoo','mg','mazda','mitsubishi','volkswagen','seat','subaru','xpeng',
    'bmw','mercedes','audi','tesla','nissan','ford','volvo','lexus','jeep','suzuki','peugeot','citroen','renault','dacia','opel','cupra','geely',
    'leapmotor','zeekr','omoda','exeed','lynkco','polestar','genesis','porsche','landrover','mini','honda','alfaromeo','fiat','ds','smart','gwm','kgm'];
  /* קבצי לוגו רשמיים: שימו קובץ בנתיב /brand-logos/<key>.svg (או png) והוסיפו את ה-key לרשימה.
     רק מותג שמופיע כאן נטען כתמונה; השאר מוצגים בשם המותג בטיפוגרפיה. */
  const BRAND_LOGOS = { /* toyota: '/brand-logos/toyota.svg', */ };
  function brandMark(key, name) {
    const src = BRAND_LOGOS[key];
    if (src) return '<img src="' + esc(src) + '" alt="" width="44" height="44" loading="lazy" decoding="async">';
    const t = String(name || key);
    return '<span class="cx-wordmark' + (t.length > 7 ? ' is-long' : '') + '" aria-hidden="true">' + esc(t) + '</span>';
  }
  function brandKey(raw) {
    const k = String(raw || '').trim().toLowerCase().replace(/[\s\-_.]+/g, '');
    if (BRANDS[k]) return k;
    if (k === 'mercedesbenz') return 'mercedes';
    return k;
  }
  function brandInfo(raw) {
    const k = brandKey(raw);
    return BRANDS[k] ? Object.assign({ key: k }, BRANDS[k]) : { key: k, name: String(raw || '').trim(), he: '', alt: [] };
  }

  /* ── סוג הנעה ──
     מקור ראשון: עמודת powertrain (Migration מוצע, ממולאת מהמפרט הרשמי).
     עד שהיא קיימת: גזירה משדה engine — שהוא עצמו נתון מהמפרט, לא משם הדגם.
     כשהערך דו-משמעי — null (לא מסווגים בכוח). */
  const PT = {
    ev:{label:'חשמלי',plural:'חשמליים'},
    phev:{label:'פלאג-אין',plural:'פלאג-אין'},
    erev:{label:'מאריך טווח',plural:'מאריך טווח'},
    hev:{label:'היברידי',plural:'היברידיים'},
    mhev:{label:'היברידי קל',plural:'היברידי קל'},
    petrol:{label:'בנזין',plural:'בנזין'},
    diesel:{label:'דיזל',plural:'דיזל'}
  };
  const PT_ALIASES = {ev:'ev',electric:'ev',bev:'ev','חשמלי':'ev',phev:'phev','פלאג-אין':'phev',hybrid:'hev',hev:'hev','היברידי':'hev',mhev:'mhev',mild:'mhev',erev:'erev',reev:'erev','היברידי קל':'mhev',petrol:'petrol',gasoline:'petrol','בנזין':'petrol',diesel:'diesel','דיזל':'diesel'};
  function derivePowertrain(c) {
    if (c.powertrain) {
      const p = PT_ALIASES[String(c.powertrain).trim().toLowerCase()] || PT_ALIASES[String(c.powertrain).trim()];
      if (p) return p;
    }
    const e = String(c.engine || '');
    const hasFuel = c.fuel_consumption != null && String(c.fuel_consumption).trim() !== '';
    if (/PHEV|פלאג/i.test(e)) return 'phev';
    if (/^\s*חשמלי/.test(e) && !hasFuel) return 'ev';
    if (c.range_ev && !hasFuel && !/בנזין|טורבו|\d\.\dL/i.test(e)) return 'ev';
    if (/מנוע(ים)? חשמלי|\+\s*חשמל/.test(e) && c.range_ev) return 'phev';
    if (/מיילד|מייל-היברידי|היברידי קל|mild/i.test(e)) return 'mhev';
    if (/היברידי|היברידית|hybrid/i.test(e)) return 'hev';
    if (/דיזל|TDI|diesel/i.test(e)) return 'diesel';
    if (/טורבו|טבעי|TSI|בנזין|\d\.\dL/i.test(e)) return 'petrol';
    return null;
  }

  /* ── הנעה (גלגלים) — מנורמל לסינון; הטקסט המקורי נשמר לתצוגה ── */
  function deriveDrive(c) {
    const d = String(c.drive_type || '');
    if (!d) return [];
    const out = [];
    if (/AWD|4x4|4WD|כפולה|4Motion|Symmetrical/i.test(d)) out.push('awd');
    if (/קדמי|קידמי|קדמית|FWD/i.test(d)) out.push('fwd');
    if (/אחורי|RWD/i.test(d)) out.push('rwd');
    return out;
  }

  /* ── עזרי פורמט ── */
  const nf = new Intl.NumberFormat('he-IL');
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  const fmtPrice = v => num(v) ? '₪' + nf.format(num(v)) : null;
  const fmtNum = v => num(v) != null ? nf.format(num(v)) : null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function consumption(c) {
    const v = parseFloat(String(c.fuel_consumption || '').replace(',', '.'));
    return isNaN(v) ? null : v;
  }
  /* מומנט (05.11.2026): כל המאגר בקג"מ, כפי שכתוב במפרט — מוצג כמו שהוא, בלי המרות וניחושים */
  function torqueText(c) {
    const t = num(c.torque);
    return t == null ? null : fmtNum(t) + ' קג״מ';
  }

  function isStock(url) {
    try { const h = new URL(url).hostname; return STOCK_HOSTS.some(s => h === s || h.endsWith('.' + s)); }
    catch (e) { return false; }
  }
  /* התמונה להצגה: image_cutout (רקע שקוף) ← image_main אמיתית ← null (צללית) */
  function pickImage(c) {
    if (c.image_cutout) return { src: c.image_cutout, cutout: true };
    if (c.image_main && !(HIDE_STOCK_IMAGES && isStock(c.image_main))) return { src: c.image_main, cutout: false };
    const g = (Array.isArray(c.gallery_images) ? c.gallery_images : []).find(u => u && !(HIDE_STOCK_IMAGES && isStock(u)));
    return g ? { src: g, cutout: false } : null;
  }
  /* wsrv.nl — אותו פרוקסי שהאתר כבר משתמש בו — להקטנה ו-WebP. תמונה שקופה נשמרת שקופה. */
  function thumb(src, w) {
    if (!src || !/^https?:/.test(src)) return src;
    if (/supabase\.co\/storage/.test(src)) return 'https://wsrv.nl/?url=' + encodeURIComponent(src) + '&w=' + w + '&output=webp&q=82';
    return src;
  }

  /* שרטוט טכני קווי של רכב גנרי (לא דגם אמיתי) — מוצג כשאין תמונה של הדגם */
  const LINE_CAR = '<svg class="cx-line-car" viewBox="0 0 400 140" aria-hidden="true">' +
    '<path d="M22 104h28M126 104h150M352 104h28"/>' +
    '<path d="M50 104c-12 0-20-6-20-15v-11c0-8 5-13 13-15l52-10 44-27c9-6 19-9 30-9h88c12 0 23 5 31 12l30 26 42 7c12 2 20 11 20 23v6c0 8-6 13-14 13h-16"/>' +
    '<path d="M126 104a38 38 0 0 0-76 0M352 104a38 38 0 0 0-76 0"/>' +
    '<circle cx="88" cy="104" r="27"/><circle cx="88" cy="104" r="15" class="soft"/>' +
    '<circle cx="314" cy="104" r="27"/><circle cx="314" cy="104" r="15" class="soft"/>' +
    '<path d="M141 51l28-17c7-4 14-6 22-6h22v23z" class="soft"/><path d="M224 28h40c9 0 17 3 23 9l15 14h-78z" class="soft"/>' +
    '<path d="M219 28v58M150 58h196" class="soft"/><path d="M12 132h376" class="dim"/>' +
    '</svg>';
  function lineCar() { return LINE_CAR; }
  function placeholder() { return LINE_CAR; }
  /* שם הדגם לטקסט הענק שמאחורי הרכב — בלי סיומות הנעה כדי שיישאר קצר */
  function ghostName(c) {
    let m = String(c.model || '').replace(/\b(PHEV|HEV|EV|Hybrid)\b/gi, '').replace(/היברידי(ת)?|חשמלי(ת)?|פלאג-?אין/g, '').replace(/\s+/g, ' ').trim();
    const parts = m.split(' ');
    if (m.length > 9 && parts.length > 1) m = parts.slice(0, 2).join(' ');
    return m || String(c.model || '');
  }
  const isHeb = t => /[֐-׿]/.test(t);
  /* הצגת הרכב: מבודד (שקוף) → תמונה רגילה במסגרת → שרטוט קווי */
  function visual(c, w, eager) {
    const im = pickImage(c);
    const alt = esc(c._brand.name + ' ' + c.model + (c.year ? ' ' + c.year : ''));
    const load = (eager ? 'fetchpriority="high"' : 'loading="lazy"') + ' decoding="async"';
    if (im && im.cutout) return { kind: 'cutout', html: '<img src="' + esc(thumb(im.src, w)) + '" alt="' + alt + '" ' + load + '>' };
    if (im) return { kind: 'photo', html: '<img src="' + esc(thumb(im.src, w)) + '" alt="' + alt + '" ' + load + ' onerror="this.replaceWith(document.createRange().createContextualFragment(window.SPCars.lineCar()))">' };
    return { kind: 'line', html: LINE_CAR };
  }
  function mediaHTML(c, w, eager) { return visual(c, w, eager).html; }

  /* ── נרמול רשומה ── */
  function normalize(c) {
    const b = brandInfo(c.brand);
    c._brand = b;
    /* שדה בסיס ריק אבל קיים בגרסה הראשונה (הגרסה הבסיסית) — לוקחים משם, כדי שכרטיסים והשוואה לא יציגו "—" כשיש נתון */
    const t0 = Array.isArray(c.trims) && c.trims[0] && typeof c.trims[0] === 'object' ? c.trims[0] : null;
    if (t0) ['engine', 'powertrain', 'horsepower', 'torque', 'acceleration_0_100', 'top_speed', 'range_ev', 'battery_capacity_kwh', 'fuel_consumption', 'transmission', 'drive_type', 'trunk_volume', 'weight', 'length', 'width', 'height', 'price']
      .forEach(k => { if ((c[k] === null || c[k] === undefined || c[k] === '') && t0[k] != null && t0[k] !== '') c[k] = t0[k]; });
    c._pt = derivePowertrain(c);
    /* דגם עם כמה סוגי הנעה (למשל חשמלי + מאריך טווח) — כל הסוגים, לסינון ולתצוגה */
    const tr = Array.isArray(c.trims) ? c.trims.filter(t => t && typeof t === 'object' && t.name) : [];
    const pts = []; tr.forEach(t => { const p = derivePowertrain(t); if (p && pts.indexOf(p) === -1) pts.push(p); });
    if (c._pt && pts.indexOf(c._pt) === -1) pts.unshift(c._pt);
    c._pts = pts.length ? pts : (c._pt ? [c._pt] : []);
    /* הספק מרבי של הגרסה הבסיסית: משולב / מנוע חשמלי ברכב חשמלי ומאריך טווח / החזק מבין השניים */
    if (t0) {
      const n = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v;
      const ptb = derivePowertrain(Object.assign({}, c, t0)), sh = n(t0.system_hp), h = n(t0.horsepower), e = n(t0.electric_hp);
      const mp = sh != null ? sh : (ptb === 'ev' || ptb === 'erev') ? (e != null ? e : h) : (h != null && e != null ? Math.max(h, e) : (h != null ? h : e));
      if (mp != null && (n(c.horsepower) == null || mp > n(c.horsepower))) c.horsepower = mp;
    }
    c._drive = deriveDrive(c);
    c._slug = c.slug || c.id;
    c._url = '/car/' + encodeURIComponent(c._slug) + '/';
    c._cons = consumption(c);
    c._seven = /7\s*מקומות|7 מושבים|שבעה מושבים/.test(String(c.category || '')) || num(c.seats) >= 7;
    c._suv = /קרוסאובר|SUV|פנאי שטח|ג'יפ/i.test(String(c.category || ''));
    c._name = [b.name, b.he, ...(b.alt || []), c.model, String(c._slug).replace(/-/g, ' ')].join(' ').toLowerCase();
    c._search = [b.name, b.he, ...(b.alt || []), c.model, c.category, c.engine, c.year, String(c._slug).replace(/-/g, ' '), c._pt ? PT[c._pt].label : '']
      .join(' ').toLowerCase();
    return c;
  }

  /* ── טעינה: Supabase REST → cars.json → גיבוי מוטמע ── */
  let _cache = null;
  async function load() {
    if (_cache) return _cache;
    let rows = null, source = 'supabase';
    try {
      const r = await fetch(SB_URL + '/rest/v1/cars?select=*&deleted=eq.false&order=sales_rank.asc.nullslast', {
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }
      });
      if (!r.ok) throw new Error('status ' + r.status);
      rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) throw new Error('empty');
    } catch (e) {
      console.warn('[cars] Supabase unavailable, falling back:', e && e.message);
      try {
        const r2 = await fetch('/cars.json');
        if (!r2.ok) throw new Error('status ' + r2.status);
        rows = await r2.json(); source = 'cars.json';
        if (!Array.isArray(rows) || !rows.length) throw new Error('empty');
      } catch (e2) {
        rows = FALLBACK_CARS.slice(); source = 'embedded';
      }
    }
    _cache = { cars: rows.map(normalize), source };
    return _cache;
  }

  /* ── כרטיס רכב אחיד ── */
  const ICO = {
    plus: '<svg class="off" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg class="on" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    heart: '<svg width="17" height="17" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.4 7.6 3.6 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4c3.6 0 5.8 3.6 4.5 7.1-1.8 4.8-9.3 9.4-9.3 9.4z"/></svg>',
    scale: '<svg class="off" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/></svg>'
  };
  /* מאפייני שורת הכרטיס לפי ההדמיה: נפח מנוע · סוג הנעה · תיבה */
  function engineLiters(c) { const m = String(c.engine || '').match(/(\d\.\d)\s*L?/i); return m ? m[1] + ' ל׳' : null; }
  function gearShort(c) { const t = String(c.transmission || ''); if (!t) return null; if (/ידני/.test(t) && !/אוטו|AMT/i.test(t)) return 'ידני'; return 'אוטומט'; }
  /* כרטיס דגם — לפי ההדמיה: תמונה על רקע בהיר, לב, שם, שורת מאפיינים, מחיר, כפתור "לפרטים נוספים" */
  /* טקסט מעורב עברית/אנגלית: כל רצף בכיוון אחד מבודד ב-<bdi> משלו, כך שהסדר נשמר
     ("Hyundai קונה", "Keyless GO - פתיחת…"). מילה עם מקף ("E-Class", "פלאג-אין") לא נשברת בין שורות. */
  function mix(s) {
    s = String(s == null ? '' : s).trim(); if (!s) return '';
    const HEB = /[\u0590-\u05FF]/, LAT = /[A-Za-z]/, SEP = /^[·•|,،;:–—\-\/]+$/, groups = [];
    let cur = '', ct = null, pend = '';
    s.split(/(\s+)/).forEach(tok => {
      if (!tok) return;
      if (/^\s+$/.test(tok)) { pend += tok; return; }
      const t = HEB.test(tok) ? 'h' : LAT.test(tok) ? 'l' : null;
      if (!t) {
        /* מפריד (· , –) סוגר את הקבוצה הנוכחית; מספר בלי מפריד נשאר צמוד למילה שלפניו */
        if (SEP.test(tok)) { cur += pend.replace(/\s+$/, ''); pend = (pend.match(/\s+$/) || [''])[0] + tok; }
        else if (pend && SEP.test(pend.trim().split(/\s+/)[0] || '')) pend += tok;
        else { cur += pend + tok; pend = ''; }
        return;
      }
      if (ct && t !== ct) { groups.push([cur, ct]); cur = pend.replace(/^\s+/, '') + tok; }
      else cur += pend + tok;
      pend = ''; ct = t;
    });
    cur += pend; groups.push([cur, ct]);
    const nw = g => esc(g.trim()).split(/(\s+)/).map(w => /\S-\S/.test(w) ? '<span class="nw">' + w + '</span>' : w).join('');
    return groups.filter(g => g[0].trim()).map(g => '<bdi dir="' + (g[1] === 'h' ? 'rtl' : g[1] === 'l' ? 'ltr' : 'auto') + '">' + nw(g[0]) + '</bdi>').join(' ');
  }
  function card(c, opts) {
    opts = opts || {};
    const v = visual(c, 640, opts.eager);
    const name = c._brand.name + ' ' + c.model;
    const line = [engineLiters(c), c._pts && c._pts.length ? c._pts.map(p => PT[p].label).join(' / ') : null, gearShort(c)].filter(Boolean);
    if (!line.length && num(c.horsepower)) line.push(fmtNum(c.horsepower) + ' כ״ס');
    const price = fmtPrice(c.price);
    const inCmp = Compare.has(c._slug), fav = Fav.has(c._slug);
    return '<article class="cx-card" data-slug="' + esc(c._slug) + '"' + (opts.i != null ? ' style="--i:' + opts.i + '"' : '') + (opts.reveal ? ' data-reveal' : '') + '>' +
      '<a class="cx-card-link" href="' + esc(c._url) + '" aria-label="' + esc(name) + ' — לעמוד הדגם"></a>' +
      '<div class="cx-card-media is-' + v.kind + '">' + v.html + '</div>' +
      '<div class="cx-card-acts">' +
        '<button type="button" class="cx-act cx-fav" data-fav="' + esc(c._slug) + '" aria-pressed="' + fav + '" aria-label="שמירה למועדפים: ' + esc(name) + '" title="שמירה">' + ICO.heart + '</button>' +
        '<button type="button" class="cx-act cx-cmp-btn" data-cmp="' + esc(c._slug) + '" aria-pressed="' + inCmp + '" aria-label="' + (inCmp ? 'הסר מההשוואה: ' : 'הוסף להשוואה: ') + esc(name) + '" title="השוואה">' + ICO.scale + ICO.check + '</button>' +
      '</div>' +
      '<div class="cx-card-body">' +
        '<h3 class="cx-card-name">' + mix(name) + '</h3>' +
        (line.length ? '<div class="cx-card-meta">' + line.map(m => '<span>' + mix(m) + '</span>').join('') + '</div>' : '') +
        '<div class="cx-price">' + (price ? '<small>מ-</small><b class="cx-num">' + price + '</b>' : '<small>מחיר טרם פורסם</small>') + '</div>' +
        '<span class="cx-card-cta" aria-hidden="true">לפרטים נוספים ' + ICO.arrow + '</span>' +
      '</div></article>';
  }
  function skeleton(n) {
    let h = '';
    for (let i = 0; i < n; i++) h += '<div class="cx-card cx-card--skel" aria-hidden="true"><div class="cx-card-media"><div class="cx-skel"></div></div><div class="cx-card-body"><div class="cx-skel" style="height:10px;width:30%"></div><div class="cx-skel" style="height:20px;width:65%;margin-top:10px"></div><div class="cx-skel" style="height:12px;width:55%;margin-top:12px"></div><div class="cx-skel" style="height:22px;width:40%;margin-top:26px"></div></div></div>';
    return h;
  }

  /* ── מועדפים (לב) — אצל הגולש בלבד ── */
  const FAV_KEY = 'sp_fav_v1';
  const Fav = {
    list: (function () { try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } })(),
    has(s) { return this.list.indexOf(s) !== -1; },
    toggle(s) {
      this.list = this.has(s) ? this.list.filter(x => x !== s) : this.list.concat(s);
      try { localStorage.setItem(FAV_KEY, JSON.stringify(this.list)); } catch (e) {}
      document.querySelectorAll('[data-fav="' + (window.CSS && CSS.escape ? CSS.escape(s) : s) + '"]').forEach(b => b.setAttribute('aria-pressed', this.has(s)));
      document.dispatchEvent(new CustomEvent('sp:fav', { detail: { count: this.list.length } }));
      return this.has(s);
    }
  };

  /* ── השוואה ── */
  function readStore() { try { const v = JSON.parse(localStorage.getItem(CMP_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, MAX_COMPARE) : []; } catch (e) { return []; } }
  function writeStore(a) { try { localStorage.setItem(CMP_KEY, JSON.stringify(a)); } catch (e) {} }
  const Compare = {
    list: readStore(),
    has(s) { return this.list.indexOf(s) !== -1; },
    toggle(s) {
      if (this.has(s)) { this.list = this.list.filter(x => x !== s); }
      else {
        if (this.list.length >= MAX_COMPARE) { toast('אפשר להשוות עד ' + MAX_COMPARE + ' דגמים. הסירו דגם כדי להוסיף אחר.'); return false; }
        this.list = this.list.concat(s);
      }
      writeStore(this.list); this.sync(); return true;
    },
    set(a) { this.list = Array.from(new Set(a)).slice(0, MAX_COMPARE); writeStore(this.list); this.sync(); },
    clear() { this.list = []; writeStore(this.list); this.sync(); },
    sync() {
      document.querySelectorAll('[data-cmp]').forEach(b => {
        const on = this.has(b.getAttribute('data-cmp'));
        b.setAttribute('aria-pressed', on);
        const nm = (b.getAttribute('aria-label') || '').replace(/^(הוסף להשוואה|הסר מההשוואה): /, '');
        b.setAttribute('aria-label', (on ? 'הסר מההשוואה: ' : 'הוסף להשוואה: ') + nm);
      });
      renderTray();
      if (cmpEl && cmpEl.classList.contains('open')) renderCompare();
      document.dispatchEvent(new CustomEvent('sp:cmp', { detail: { list: this.list.slice() } }));
    }
  };

  let carsBySlug = {};
  function setCars(cars) { carsBySlug = {}; cars.forEach(c => { carsBySlug[c._slug] = c; }); Compare.list = Compare.list.filter(s => carsBySlug[s]); writeStore(Compare.list); }

  let trayEl = null, cmpEl = null, toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'cx-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  function renderTray() {
    if (!trayEl) {
      trayEl = document.createElement('div'); trayEl.className = 'cx-tray'; trayEl.setAttribute('role', 'region'); trayEl.setAttribute('aria-label', 'רכבים להשוואה');
      document.body.appendChild(trayEl);
      trayEl.addEventListener('click', e => {
        const rm = e.target.closest('[data-tray-rm]'); if (rm) { Compare.toggle(rm.getAttribute('data-tray-rm')); return; }
        if (e.target.closest('[data-tray-go]')) openCompare();
        if (e.target.closest('[data-tray-clear]')) Compare.clear();
      });
    }
    const L = Compare.list.filter(s => carsBySlug[s]);
    trayEl.classList.toggle('show', L.length > 0);
    document.body.style.paddingBottom = L.length ? 'calc(88px + var(--dock-h, 0px))' : '';
    let slots = '';
    for (let i = 0; i < MAX_COMPARE; i++) {
      const c = carsBySlug[L[i]];
      if (c) {
        const im = pickImage(c);
        slots += '<div class="cx-tray-slot" title="' + esc(c._brand.name + ' ' + c.model) + '">' + (im ? '<img src="' + esc(thumb(im.src, 160)) + '" alt="">' : placeholder()) +
          '<button type="button" data-tray-rm="' + esc(c._slug) + '" aria-label="הסר ' + esc(c._brand.name + ' ' + c.model) + '"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>';
      } else slots += '<div class="cx-tray-slot" aria-hidden="true"></div>';
    }
    trayEl.innerHTML = '<div class="cx-tray-slots">' + slots + '</div>' +
      '<div class="cx-tray-txt"><b>' + L.length + ' נבחרו</b><span>' + (L.length < 2 ? 'בחרו עוד דגם' : 'מוכן להשוואה') + '</span></div>' +
      '<button type="button" class="cx-btn cx-btn--primary" data-tray-go ' + (L.length < 2 ? 'disabled style="opacity:.55;cursor:not-allowed"' : '') + '>השוואה' + (L.length >= 2 ? ' (' + L.length + ')' : '') + '</button>' +
      '<button type="button" class="cx-tray-clear" data-tray-clear>נקה</button>';
  }

  /* שורות מסך ההשוואה. best: 'max'/'min' — מסומן רק בין רכבים שיש להם נתון, ורק כשיש לפחות 2. */
  const ROWS = [
    { g: 'מחיר' },
    { k: 'price', t: 'מחיר החל מ-', v: c => num(c.price), f: c => fmtPrice(c.price), best: 'min' },
    { k: 'price_top', t: 'גרסה מאובזרת', v: c => num(c.price_top), f: c => fmtPrice(c.price_top) },
    { g: 'מנוע וביצועים' },
    { k: 'pt', t: 'סוג הנעה', f: c => c._pts && c._pts.length ? c._pts.map(p => PT[p].label).join(' / ') : null },
    { k: 'engine', t: 'מנוע', f: c => c.engine || null, small: true },
    { k: 'hp', t: 'הספק (כ״ס)', v: c => num(c.horsepower), f: c => fmtNum(c.horsepower), best: 'max' },
    { k: 'tq', t: 'מומנט', f: c => torqueText(c) },
    { k: 'acc', t: '0-100 קמ״ש (שנ׳)', v: c => num(c.acceleration_0_100), f: c => num(c.acceleration_0_100) != null ? String(num(c.acceleration_0_100)) : null, best: 'min' },
    { k: 'vmax', t: 'מהירות מרבית (קמ״ש)', v: c => num(c.top_speed), f: c => fmtNum(c.top_speed), best: 'max' },
    { k: 'gear', t: 'תיבת הילוכים', f: c => c.transmission || null, small: true },
    { k: 'drive', t: 'הנעה', f: c => c.drive_type || null, small: true },
    { g: 'צריכת אנרגיה' },
    { k: 'cons', t: 'צריכת דלק (ל׳/100 ק״מ)', v: c => c._cons, f: c => c._cons != null ? String(c._cons) : null, best: 'min' },
    { k: 'rev', t: 'טווח חשמלי (ק״מ)', v: c => num(c.range_ev), f: c => fmtNum(c.range_ev), best: 'max' },
    { k: 'batt', t: 'סוללה (קוט״ש)', v: c => num(c.battery_capacity_kwh), f: c => num(c.battery_capacity_kwh) != null ? String(num(c.battery_capacity_kwh)) : null, best: 'max' },
    { g: 'מידות ושימושיות' },
    { k: 'len', t: 'אורך (מ״מ)', f: c => fmtNum(c.length) },
    { k: 'wid', t: 'רוחב (מ״מ)', f: c => fmtNum(c.width) },
    { k: 'hei', t: 'גובה (מ״מ)', f: c => fmtNum(c.height) },
    { k: 'wb', t: 'בסיס גלגלים (מ״מ)', v: c => num(c.wheelbase), f: c => fmtNum(c.wheelbase), best: 'max' },
    { k: 'seats', t: 'מושבים', f: c => fmtNum(c.seats) },
    { k: 'trunk', t: 'תא מטען (ל׳)', v: c => num(c.trunk_volume), f: c => fmtNum(c.trunk_volume), best: 'max' },
    { k: 'w', t: 'משקל (ק״ג)', f: c => fmtNum(c.weight) },
    { g: 'בטיחות' },
    { k: 'ncap', t: 'דירוג בטיחות', f: c => c.safety_rating || null, small: true },
    { k: 'poll', t: 'דרגת זיהום', f: c => fmtNum(c.pollution_index) },
    { k: 'warranty', t: 'אחריות', f: c => c.warranty || null, small: true }
  ];
  function renderCompare() {
    const L = Compare.list.map(s => carsBySlug[s]).filter(Boolean);
    const body = cmpEl.querySelector('.cx-cmp-body .cx-wrap');
    const all = Object.values(carsBySlug).sort((a, b) => (a._brand.name + a.model).localeCompare(b._brand.name + b.model, 'he'));
    const addSel = L.length < MAX_COMPARE ? '<div class="cx-cmp-add"><label class="cx-sr" for="cx-cmp-add">הוספת דגם להשוואה</label><select class="cx-select" id="cx-cmp-add"><option value="">+ הוספת דגם להשוואה</option>' +
      all.filter(c => !Compare.has(c._slug)).map(c => '<option value="' + esc(c._slug) + '">' + esc(c._brand.name + ' ' + c.model + (c.year ? ' ' + c.year : '')) + '</option>').join('') + '</select>' +
      '<button type="button" class="cx-btn cx-btn--outline cx-btn--sm" data-cmp-share>העתקת קישור להשוואה</button></div>' : '<div class="cx-cmp-add"><button type="button" class="cx-btn cx-btn--outline cx-btn--sm" data-cmp-share>העתקת קישור להשוואה</button></div>';
    if (L.length < 2) {
      body.innerHTML = addSel + '<div class="cx-empty"><h3>בחרו לפחות שני דגמים</h3><p>לחצו על כפתור ה-+ בכרטיסי הרכב, או הוסיפו דגם מהרשימה למעלה.</p></div>';
      bindAdd(); return;
    }
    let head = '<thead><tr><th scope="col"><span class="cx-sr">מאפיין</span></th>' + L.map(c => {
      const im = pickImage(c);
      return '<th scope="col"><button type="button" class="cx-cmp-rm" data-cmp-rm="' + esc(c._slug) + '" aria-label="הסר ' + esc(c._brand.name + ' ' + c.model) + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '<div class="cx-cmp-car"><div class="cx-cmp-img' + (im && !im.cutout ? ' is-photo' : '') + '">' + visual(c, 480).html + '</div>' +
        '<small>' + mix(c._brand.name) + '' + (c.year ? ' · ' + c.year : '') + '</small><b>' + mix(c.model) + '</b><a href="' + esc(c._url) + '">לעמוד הדגם</a></div></th>';
    }).join('') + '</tr></thead>';
    let rows = '', group = null, groupRows = [];
    const flush = () => { if (group && groupRows.length) rows += '<tr class="cx-cmp-group"><th scope="rowgroup" colspan="' + (L.length + 1) + '">' + esc(group) + '</th></tr>' + groupRows.join(''); groupRows = []; };
    ROWS.forEach(r => {
      if (r.g) { flush(); group = r.g; return; }
      const vals = L.map(c => r.f(c));
      if (vals.every(v => v == null)) return; // שורה בלי שום נתון — לא מוצגת
      let bestIdx = [];
      if (r.best && r.v) {
        const nums = L.map(c => r.v(c));
        const have = nums.filter(n => n != null);
        if (have.length >= 2 && new Set(have).size > 1) {
          const target = r.best === 'max' ? Math.max(...have) : Math.min(...have);
          nums.forEach((n, i) => { if (n === target) bestIdx.push(i); });
        }
      }
      groupRows.push('<tr><th scope="row">' + esc(r.t) + '</th>' + vals.map((v, i) =>
        '<td' + (r.small ? ' style="font-size:.84rem"' : '') + '>' + (v == null ? '<span class="cx-na" title="אין נתון במאגר">—</span>' : (bestIdx.indexOf(i) !== -1 ? '<bdi class="cx-best cx-num">' + esc(v) + '</bdi>' : '<bdi class="cx-num">' + esc(v) + '</bdi>')) + '</td>').join('') + '</tr>');
    });
    flush();
    body.innerHTML = addSel + '<div class="cx-cmp-scroll"><table class="cx-cmp-table">' + head + '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="cx-cmp-note">הערך הטוב ביותר בכל שורה מסומן בירוק, רק כשלפחות לשני דגמים יש נתון. "—" פירושו שהנתון עדיין לא קיים במאגר, ולא נחשב חיסרון. הנתונים לפי מפרטי היצרן/היבואן.</p>';
    bindAdd();
  }
  function bindAdd() {
    const s = cmpEl.querySelector('#cx-cmp-add');
    if (s) s.onchange = () => { if (s.value) { Compare.toggle(s.value); writeCmpURL(); } };
  }
  function writeCmpURL() {
    try {
      const u = new URL(location.href);
      if (cmpEl && cmpEl.classList.contains('open') && Compare.list.length) u.searchParams.set('compare', Compare.list.join(','));
      else u.searchParams.delete('compare');
      history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash);
    } catch (e) {}
  }
  let lastFocus = null;
  function openCompare(slugs) {
    if (slugs && slugs.length) Compare.set(slugs.filter(s => carsBySlug[s]));
    if (!cmpEl) {
      cmpEl = document.createElement('div'); cmpEl.className = 'cx-cmp'; cmpEl.setAttribute('role', 'dialog'); cmpEl.setAttribute('aria-modal', 'true'); cmpEl.setAttribute('aria-labelledby', 'cx-cmp-title');
      cmpEl.innerHTML = '<div class="cx-cmp-head"><div class="cx-wrap"><h2 id="cx-cmp-title">השוואת רכבים</h2><button type="button" class="cx-icon-btn" data-cmp-close aria-label="סגירת ההשוואה"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div></div><div class="cx-cmp-body"><div class="cx-wrap"></div></div>';
      document.body.appendChild(cmpEl);
      cmpEl.addEventListener('click', e => {
        if (e.target.closest('[data-cmp-close]')) closeCompare();
        const rm = e.target.closest('[data-cmp-rm]'); if (rm) { Compare.toggle(rm.getAttribute('data-cmp-rm')); writeCmpURL(); }
        if (e.target.closest('[data-cmp-share]')) {
          const u = new URL(location.href); u.searchParams.set('compare', Compare.list.join(','));
          const done = () => toast('הקישור להשוואה הועתק');
          try { navigator.clipboard.writeText(u.toString()).then(done, () => prompt('העתיקו את הקישור:', u.toString())); } catch (er) { prompt('העתיקו את הקישור:', u.toString()); }
        }
      });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && cmpEl.classList.contains('open')) closeCompare(); });
    }
    lastFocus = document.activeElement;
    cmpEl.classList.add('open'); document.documentElement.style.overflow = 'hidden';
    renderCompare(); writeCmpURL();
    const cl = cmpEl.querySelector('[data-cmp-close]'); cl && cl.focus();
  }
  function closeCompare() {
    cmpEl.classList.remove('open'); document.documentElement.style.overflow = '';
    writeCmpURL(); if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* האזנה גלובלית: לב (מועדפים) */
  document.addEventListener('click', e => {
    const f = e.target.closest('[data-fav]');
    if (!f) return;
    e.preventDefault(); e.stopPropagation();
    const on = Fav.toggle(f.getAttribute('data-fav'));
    f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop');
    toast(on ? 'נשמר במועדפים' : 'הוסר מהמועדפים');
  });
  /* האזנה גלובלית לכפתורי "+ השוואה" בכל כרטיס */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-cmp]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const s = b.getAttribute('data-cmp');
    const was = Compare.has(s);
    if (Compare.toggle(s) && !was) {
      const c = carsBySlug[s];
      toast((c ? c._brand.name + ' ' + c.model : 'הדגם') + ' נוסף להשוואה');
    }
  });

  /* ═══ מובייל (08.11.2026): תפריט עם רקע וסגירה, כותרת שנעלמת בגלילה למטה, לשוניות דביקות ופס פעולות בעמוד הדגם ═══ */
  (function mobileChrome() {
    /* מד קטן בלוגו — המחוג מזנק בטעינה ובריחוף (10.11.2026) */
    const lg = document.querySelector('.cx-logo b');
    if (lg && !lg.querySelector('svg')) lg.insertAdjacentHTML('afterbegin', '<svg class="cx-logo-g" width="28" height="24" viewBox="0 0 28 24" fill="none" aria-hidden="true"><path d="M3 19a11 11 0 0 1 22 0" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M6.2 11.2l1.5 1.3M14 6.5v2M21.8 11.2l-1.5 1.3" stroke="#9fb0c3" stroke-width="1.6" stroke-linecap="round"/><g class="cx-logo-n"><path d="M14 17V8.5" stroke="#ff4d5e" stroke-width="2.4" stroke-linecap="round"/></g><circle cx="14" cy="17" r="2.4" fill="#fff"/></svg>');
    const mq = window.matchMedia('(max-width: 900px)');
    const nav = document.getElementById('cx-nav'), btn = document.getElementById('hdr-menu');
    if (nav && btn) {
      const bk = document.createElement('div'); bk.className = 'cx-nav-bk'; bk.setAttribute('aria-hidden', 'true'); document.body.appendChild(bk);
      const close = () => { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
      const sync = () => { const o = nav.classList.contains('open'); document.body.classList.toggle('nav-open', o); btn.setAttribute('aria-label', o ? 'סגירת התפריט' : 'תפריט'); if (o) document.body.classList.remove('hdr-hide'); };
      new MutationObserver(sync).observe(nav, { attributes: true, attributeFilter: ['class'] });
      bk.addEventListener('click', close);
      nav.addEventListener('click', e => { if (e.target.closest('a,button')) close(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { close(); btn.focus(); } });
      mq.addEventListener && mq.addEventListener('change', () => { if (!mq.matches) close(); });
    }
    let lastY = window.scrollY, dock = null, sub = null, isView = false, ticking = false;
    function frame() {
      ticking = false;
      const y = window.scrollY, d = y - lastY;
      if (!dock) { dock = document.querySelector('.cp-dock'); if (dock) { document.body.classList.add('has-dock'); document.documentElement.classList.add('has-cp'); } }
      if (!sub) sub = document.querySelector('.cp-subnav');
      const open = document.body.classList.contains('nav-open');
      if (mq.matches && !open) {
        if (y < 140 || d < -6) document.body.classList.remove('hdr-hide');
        else if (d > 6) document.body.classList.add('hdr-hide');
      } else document.body.classList.remove('hdr-hide');
      if (Math.abs(d) > 6 || y < 140) lastY = y;
      isView = /[?&]view=/.test(location.search);
      if (dock) dock.classList.toggle('on', mq.matches && !open && (y > 160 || isView));
      if (sub) { const t = sub.getBoundingClientRect().top; sub.classList.toggle('is-stuck', t <= 66 && y > 40); }
    }
    const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', req);
    window.addEventListener('popstate', () => setTimeout(req, 30));
    document.addEventListener('click', () => setTimeout(req, 60));
    setTimeout(req, 400); setTimeout(req, 1500);
  })();

  window.SPCars = {
    BRAND_ORDER, BRAND_LOGOS, brandMark, visual, lineCar, ghostName, isHeb, load, normalize, brandInfo, brandKey, BRANDS, PT, derivePowertrain, pickImage, thumb, placeholder, card, skeleton, mix,
    fmtPrice, fmtNum, num, esc, Compare, Fav, setCars, openCompare, closeCompare, toast, isStock, renderTray
  };
})();
