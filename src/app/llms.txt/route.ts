export function GET() {
  return new Response(`# SpeedZone Motorsports

Used vehicle dealership in Worcester, Massachusetts.
Phone: (508) 826-9405
Address: 1094 Main St, Worcester, MA 01603
Hours: Monday-Friday 10am-4pm, Saturday by appointment

- [Home](https://www.speedzonems.com/)
- [Vehicle availability](https://www.speedzonems.com/inventory)
- [Sell your car](https://www.speedzonems.com/sell-your-car)
- [Buying costs](https://www.speedzonems.com/buying-costs)
- [Recall information](https://www.speedzonems.com/recall-check)
- [Road trips](https://www.speedzonems.com/road-trip)
- [Privacy](https://www.speedzonems.com/privacy)
- [Terms](https://www.speedzonems.com/terms)
`, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
