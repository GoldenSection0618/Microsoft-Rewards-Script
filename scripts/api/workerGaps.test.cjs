const assert = require('node:assert/strict')
const test = require('node:test')

require('../../node_modules/ts-node/register/transpile-only.js')
const Activities = require('../../src/functions/Activities.ts').default
const { PromotionActivityRunner } = require('../../src/functions/activities/rewards/PromotionActivityRunner.ts')
const { PunchCards } = require('../../src/functions/activities/rewards/PunchCards.ts')
const {
    stages,
    postWaitStages,
    account,
    promotion,
    createActivityBot,
    createFlowBot
} = require('./workerGaps.fixture.cjs')

for (const [name, items, expected] of [
    ['empty', [], []],
    ['completed', [promotion({ complete: true })], []],
    ['zero-point', [promotion({ pointProgressMax: 0 })], []],
    ['pending', [promotion()], ['offline-offer']],
    ['mixed', [promotion({ complete: true, offerId: 'completed' }), promotion()], ['offline-offer']]
]) {
    for (const method of ['doDailySet', 'doMorePromotions']) {
        test(`${method}: ${name} tasks report execution only when actionable`, async t => {
            const { bot, dashboard } = createActivityBot(t)
            dashboard.dashboard.dailySetPromotions['2026-10-24'] = items
            dashboard.dashboard.morePromotions = items
            const run = t.mock.method(PromotionActivityRunner.prototype, 'run', async () => {})
            const didExecute = await new Activities(bot)[method](dashboard)
            assert.equal(didExecute, expected.length > 0)
            assert.equal(run.mock.callCount(), expected.length > 0 ? 1 : 0)
            if (expected.length)
                assert.deepEqual(
                    run.mock.calls[0].arguments[0].map(item => item.offerId),
                    expected
                )
            assert.equal(bot.http.request.mock.callCount(), 0)
            assert.equal(bot.utils.wait.mock.callCount(), 0)
        })
    }
}

test('more promotions merge both feeds and execute a duplicated pending offer only once', async t => {
    const { bot, dashboard } = createActivityBot(t)
    dashboard.dashboard.morePromotions = [promotion({ complete: true, offerId: 'done' }), promotion()]
    dashboard.dashboard.morePromotionsWithoutPromotionalItems = [promotion(), promotion({ offerId: 'second' })]
    const run = t.mock.method(PromotionActivityRunner.prototype, 'run', async () => {})
    assert.equal(await new Activities(bot).doMorePromotions(dashboard), true)
    assert.deepEqual(
        run.mock.calls[0].arguments[0].map(item => item.offerId),
        ['offline-offer', 'second']
    )
})

test('a completed invocation does not inherit execution from the previous invocation', async t => {
    const { bot, dashboard } = createActivityBot(t)
    const activities = new Activities(bot)
    const run = t.mock.method(PromotionActivityRunner.prototype, 'run', async () => {})
    dashboard.dashboard.morePromotions = [promotion()]
    assert.equal(await activities.doMorePromotions(dashboard), true)
    dashboard.dashboard.morePromotions[0].complete = true
    assert.equal(await activities.doMorePromotions(dashboard), false)
    assert.equal(run.mock.callCount(), 1)
})

for (const [name, attributes, expected] of [
    ['empty', null, false],
    ['completed', { complete: 'True', type: 'sapphire', offerid: 'app-done' }, false],
    ['unsupported', { complete: 'False', type: 'other', offerid: 'app-other' }, false],
    ['missing offer id', { complete: 'False', type: 'sapphire' }, false],
    ['pending', { complete: 'False', type: 'sapphire', offerid: 'app-pending' }, true]
]) {
    test(`app promotions: ${name} tasks return the execution state`, async t => {
        const { bot } = createActivityBot(t)
        const promotions = attributes ? [{ attributes }] : []
        assert.equal(await new Activities(bot).doAppPromotions({ response: { promotions } }), expected)
        assert.equal(bot.activities.doAppReward.mock.callCount(), expected ? 1 : 0)
        assert.equal(bot.utils.wait.mock.callCount(), 0)
    })
}

for (const method of ['doPunchCardsMobile', 'doPunchCardsDesktop']) {
    for (const [name, parents, expected] of [
        ['unavailable', null, false],
        ['empty', [], false],
        ['completed', [promotion({ complete: true })], false],
        ['zero-point', [promotion({ pointProgressMax: 0 })], false],
        ['pending', [promotion()], true]
    ]) {
        test(`${method}: ${name} quests execute only when actionable`, async t => {
            const { bot, dashboard } = createActivityBot(t)
            t.mock.method(PunchCards.prototype, 'getParentQuests', async () => parents)
            const solve = t.mock.method(PunchCards.prototype, 'solvePunchCard', async () => {})
            assert.equal(
                await new Activities(bot)[method](dashboard),
                method === 'doPunchCardsMobile' ? expected : undefined
            )
            assert.equal(solve.mock.callCount(), expected ? 1 : 0)
        })
    }
}

for (const method of ['doDailyCheckIn', 'doReadToEarn']) {
    for (const available of [false, true]) {
        test(`${method}: ${available ? 'attempted zero-gain activity counts as work' : 'missing token skips without work'}`, async t => {
            const { bot } = createActivityBot(t)
            bot.accessToken = available ? 'offline-token' : ''
            assert.equal(await new Activities(bot)[method](), available)
            assert.equal(bot.http.request.mock.callCount(), available ? 1 : 0)
        })
    }
}

for (const available of [false, true]) {
    test(`claim bonus: ${available ? 'submitted action counts as work' : 'missing action skips without work'}`, async t => {
        const { bot } = createActivityBot(t)
        if (available) bot.nextActions.reportClaimAllPoints = 'offline-action'
        assert.equal(await new Activities(bot).doClaimBonusPoints(), undefined)
        assert.equal(bot.browser.func.reportServerAction.mock.callCount(), available ? 1 : 0)
    })
}

for (const [name, state, expected] of [
    ['already enabled', { isProtectionOn: true, remainingDays: 3 }, false],
    ['no remaining days', { isProtectionOn: false, remainingDays: 0 }, false],
    ['pending', { isProtectionOn: false, remainingDays: 3 }, true]
]) {
    test(`streak protection: ${name} submits an action only when needed`, async t => {
        const { bot } = createActivityBot(t)
        bot.nextActions.reportSetStreakProtection = 'offline-action'
        bot.reactSnapshot = { streakProtection: state }
        assert.equal(await new Activities(bot).doEnsureStreakProtection(), undefined)
        assert.equal(bot.browser.func.reportServerAction.mock.callCount(), expected ? 1 : 0)
    })
}

for (const reportable of [false, true]) {
    test(`search perk: ${reportable ? 'pending activation counts as work' : 'activated offer skips without work'}`, async t => {
        const { bot, dashboard } = createActivityBot(t)
        dashboard.dashboard.promotionalItem = promotion({ attributes: { searchMultiplier: '2' } })
        bot.nextActions.reportActivity = 'offline-action'
        bot.browser.func.ensureOffer = async () => ({ reportable, hash: 'offline-hash' })
        assert.equal(await new Activities(bot).doActivateSearchPerk(dashboard), reportable)
        assert.equal(bot.browser.func.reportServerAction.mock.callCount(), reportable ? 1 : 0)
    })
}

for (const mode of ['browser', 'full-api']) {
    test(`${mode}: ten skipped stages produce no worker waits`, async t => {
        const { bot, events } = createFlowBot(t, mode)
        await bot.Main(account)
        assert.deepEqual([...events].sort(), [...stages].sort())
        assert.equal(bot.utils.wait.mock.callCount(), 0)
        assert.equal(bot.utils.randomDelay.mock.callCount(), 0)
    })

    for (const stage of stages) {
        const hasWait = postWaitStages.includes(stage) || stage === 'doClaimBonusPoints'
        test(`${mode}: ${stage} preserves its original ${hasWait ? 'single interval' : 'absence of an interval'}`, async t => {
            const { bot, events } = createFlowBot(t, mode, [stage])
            await bot.Main(account)
            assert.deepEqual(
                bot.utils.randomDelay.mock.calls.map(call => call.arguments),
                hasWait ? [[60000, 240000]] : []
            )
            assert.deepEqual(
                bot.utils.wait.mock.calls.map(call => call.arguments),
                hasWait ? [[60000]] : []
            )
            if (hasWait) {
                const offset = stage === 'doClaimBonusPoints' ? -1 : 1
                assert.deepEqual(events[events.indexOf(stage) + offset], ['wait', 60000])
            }
            if (stage === 'doClaimBonusPoints') assert.equal(events.at(-1), stage)
        })
    }

    test(`${mode}: multiple executed stages retain the original number of intervals`, async t => {
        const { bot } = createFlowBot(t, mode, stages)
        await bot.Main(account)
        assert.equal(bot.utils.wait.mock.callCount(), postWaitStages.length + 1)
        assert.deepEqual(
            bot.utils.randomDelay.mock.calls.map(call => call.arguments),
            Array.from({ length: postWaitStages.length + 1 }, () => [60000, 240000])
        )
    })

    test(`${mode}: disabling workers calls no activities and adds no waits`, async t => {
        const { bot, events } = createFlowBot(t, mode, stages)
        bot.config.ensureStreakProtection = false
        for (const name of Object.keys(bot.config.workers)) bot.config.workers[name] = false
        await bot.Main(account)
        assert.deepEqual(events, [])
    })

    for (const completed of [false, true]) {
        test(`${mode}: real ${completed ? 'completed' : 'empty'} promotion workers pass through Main without waiting`, async t => {
            const { bot, dashboard } = createFlowBot(t, mode)
            const real = new Activities(bot)
            for (const method of ['doDailySet', 'doMorePromotions', 'doAppPromotions'])
                bot.activities[method] = real[method]
            if (completed) {
                dashboard.dashboard.dailySetPromotions['2026-10-24'] = [promotion({ complete: true })]
                dashboard.dashboard.morePromotions = [promotion({ complete: true })]
                bot.browser.func.getAppDashboardData = async () => ({
                    response: {
                        promotions: [
                            {
                                attributes: { complete: 'True', type: 'sapphire', offerid: 'completed-app-offer' }
                            }
                        ]
                    }
                })
            }
            await bot.Main(account)
            assert.equal(bot.utils.wait.mock.callCount(), 0)
            assert.equal(bot.http.request.mock.callCount(), 0)
        })
    }

    test(`${mode}: a pending promotion retains its interval through the real activity wrapper`, async t => {
        const { bot, dashboard } = createFlowBot(t, mode)
        dashboard.dashboard.morePromotions = [promotion()]
        bot.activities.doMorePromotions = new Activities(bot).doMorePromotions
        const run = t.mock.method(PromotionActivityRunner.prototype, 'run', async () => {})
        await bot.Main(account)
        assert.equal(run.mock.callCount(), 1)
        assert.deepEqual(
            bot.utils.wait.mock.calls.map(call => call.arguments),
            [[60000]]
        )
    })

    test(`${mode}: a thrown activity does not become a skip or continue to a later stage`, async t => {
        const { bot, events } = createFlowBot(t, mode)
        const failure = new Error('offline activity failure')
        bot.activities.doMorePromotions = async () => {
            throw failure
        }
        await assert.rejects(bot.Main(account), error => error === failure)
        assert.ok(!events.includes('doDailyCheckIn'))
        assert.equal(bot.utils.wait.mock.callCount(), 0)
        assert.ok(bot.browser.func.closeBrowser.mock.callCount() > 0)
    })
}
