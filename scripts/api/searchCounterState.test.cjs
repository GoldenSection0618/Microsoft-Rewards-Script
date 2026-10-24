const assert = require('node:assert/strict')
const test = require('node:test')
require('../../node_modules/ts-node/register/transpile-only.js')
const BrowserFunc = require('../../src/browser/BrowserFunc.ts').default
const { SearchManager } = require('../../src/functions/activities/search/SearchManager.ts')
const { mapFlyoutToDashboard } = require('../../src/browser/FlyoutDashboard.ts')
const { createBot, account } = require('./rewardsPoints.fixture.cjs')

for (const [name, counters, desktop, mobile] of [
    ['missing mobile counter', { pcSearch: [{ pointProgress: 60, pointProgressMax: 60 }] }, 0, null],
    ['empty counters', { pcSearch: [], mobileSearch: [] }, null, null],
    [
        'explicit zero quota',
        {
            pcSearch: [{ pointProgress: 50, pointProgressMax: 60 }],
            mobileSearch: [{ pointProgress: 0, pointProgressMax: 0 }]
        },
        10,
        0
    ],
    ['invalid progress', { pcSearch: [{ pointProgress: NaN, pointProgressMax: 60 }] }, null, null],
    ['invalid maximum', { pcSearch: [{ pointProgress: 5, pointProgressMax: NaN }] }, null, null],
    ['over-completed counter', { pcSearch: [{ pointProgress: 65, pointProgressMax: 60 }] }, 0, null],
    [
        'partial counters on both platforms',
        {
            pcSearch: [{ pointProgress: 10, pointProgressMax: 60 }],
            mobileSearch: [{ pointProgress: 5, pointProgressMax: 30 }]
        },
        50,
        25
    ]
]) {
    test(`${name} preserves the distinction between unknown and zero remaining points`, async t => {
        const { bot, dashboard } = createBot(t)
        dashboard.dashboard.userStatus.counters = counters
        const points = await new BrowserFunc(bot).getBrowserEarnablePoints(dashboard)
        assert.equal(points.desktopSearchPoints, desktop)
        assert.equal(points.mobileSearchPoints, mobile)
        assert.equal(points.totalEarnablePoints, desktop === null || mobile === null ? null : desktop + mobile)
        assert.equal(bot.http.request.mock.callCount(), 0)
    })
}

test('a partial flyout response does not make a missing mobile counter complete', async t => {
    const { bot } = createBot(t)
    const data = mapFlyoutToDashboard({
        userInfo: { isRewardsUser: true, balance: 100, profile: { attributes: { country: 'CN' } } },
        flyoutResult: {
            userStatus: {
                isRewardsUser: true,
                availablePoints: 100,
                counters: { PCSearch: [{ pointProgress: 60, pointProgressMax: 60 }] }
            }
        }
    })
    const points = await new BrowserFunc(bot).getBrowserEarnablePoints(data)
    assert.equal(points.desktopSearchPoints, 0)
    assert.equal(points.mobileSearchPoints, null)
})

test('search planning describes an absent quota separately from a completed quota', async t => {
    const { bot, dashboard } = createBot(t)
    bot.config.workers.doMobileSearch = true
    bot.config.workers.doDesktopSearch = true
    dashboard.dashboard.userStatus.counters = {
        pcSearch: [{ pointProgress: 60, pointProgressMax: 60 }],
        mobileSearch: []
    }
    const plan = await new SearchManager(bot).getSearchPoints()
    assert.equal(plan.doMobile, false)
    assert.equal(plan.doDesktop, false)
    const message = bot.logger.info.mock.calls.at(-1).arguments[2]
    assert.match(message, /移动端: skip \(quota not provided\)/)
    assert.match(message, /桌面端: skip \(complete, 60\/60\)/)
})

for (const desktopAvailable of [true, false]) {
    test(`Main logs ${desktopAvailable ? 'confirmed desktop completion' : 'missing desktop data'} accurately`, async t => {
        const { bot } = createBot(t)
        bot.browser.func.getBrowserEarnablePoints = async () => ({
            desktopSearchPoints: desktopAvailable ? 0 : null,
            mobileSearchPoints: null
        })
        await bot.Main(account)
        const message = bot.logger.info.mock.calls.find(call => call.arguments[1] === 'POINTS').arguments[2]
        assert.match(message, /移动端: 未提供/)
        assert.ok(message.includes(`浏览器: ${desktopAvailable ? '0' : '未提供'}`))
        assert.equal(bot.http.request.mock.callCount(), 0)
    })
}
