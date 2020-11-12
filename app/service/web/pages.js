'use strict';
const Service = require('egg').Service;

class PagesService extends Service {

    // 获得页面性能数据平均值
    async getAveragePageList(ctx) {
        const query = ctx.request.query;
        const appId = query.appId;
        let type = query.type || 1;
        let pageNo = query.pageNo || 1;
        let pageSize = query.pageSize || this.app.config.pageSize;
        const beginTime = query.beginTime;
        const endTime = query.endTime;
        const url = query.url;
        let tabtype = query.tabtype || 1;

        pageNo = pageNo * 1;
        pageSize = pageSize * 1;
        type = type * 1;
        tabtype = tabtype * 1;

        // 查询参数拼接
        const queryjson = { $match: {
            speed_type: type,
            is_first_in: tabtype,
            create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) },
        } };

        if (url) queryjson.$match.url = { $regex: new RegExp(url, 'i') };

        const group_id = {
            url: '$url',
        };
        return url ? await this.oneThread(appId, queryjson, pageNo, pageSize, group_id)
            : await this.moreThread(appId, type, beginTime, endTime, queryjson, pageNo, pageSize, group_id);

    }

    // 获得多个页面的平均性能数据
    async moreThread(appId, type, beginTime, endTime, queryjson, pageNo, pageSize, group_id) {
        const result = [];
        let distinct = await this.app.models.WebPages(appId).distinct('url', queryjson.$match).read('sp')
            .exec() || [];
        const copdistinct = distinct;

        const betinIndex = (pageNo - 1) * pageSize;
        if (distinct && distinct.length) {
            distinct = distinct.slice(betinIndex, betinIndex + pageSize);
        }

        const resolvelist = [];
        for (let i = 0, len = distinct.length; i < len; i++) {
            queryjson.$match.url = distinct[i];
            resolvelist.push(
                Promise.resolve(
                    this.app.models.WebPages(appId).aggregate([
                        { $match: { speed_type: type, url: distinct[i], create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } } },
                        {
                            $group: {
                                _id: group_id,
                                count: { $sum: 1 },
                                load_time: { $avg: '$load_time' },
                                dns_time: { $avg: '$dns_time' },
                                tcp_time: { $avg: '$tcp_time' },
                                dom_time: { $avg: '$dom_time' },
                                white_time: { $avg: '$white_time' },
                                request_time: { $avg: '$request_time' },
                                analysisDom_time: { $avg: '$analysisDom_time' },
                                ready_time: { $avg: '$ready_time' },
                            },
                        },
                    ]).read('sp')
                        .exec()
                )
            );
        }
        const all = await Promise.all(resolvelist) || [];
        all.forEach(item => {
            result.push(item[0]);
        });
        /* eslint-disable */
        result.sort(function (obj1, obj2) {
            let val1 = obj1.count;
            let val2 = obj2.count;
            if (val1 < val2) {
                return 1;
            } else if (val1 > val2) {
                return -1;
            } else {
                return 0;
            }
        });
        /* eslint-enable */
        this.app.logger.info(`--------datalist-------${JSON.stringify(result)}------`);
        return {
            datalist: result,
            totalNum: copdistinct.length,
            pageNo,
        };
    }

    // 单个页面查询平均信息
    async oneThread(appId, queryjson, pageNo, pageSize, group_id) {
        const count = Promise.resolve(this.app.models.WebPages(appId).distinct('url', queryjson.$match).read('sp')
            .exec());
        const datas = Promise.resolve(
            this.app.models.WebPages(appId).aggregate([
                queryjson,
                {
                    $group: {
                        _id: group_id,
                        count: { $sum: 1 },
                        load_time: { $avg: '$load_time' },
                        dns_time: { $avg: '$dns_time' },
                        tcp_time: { $avg: '$tcp_time' },
                        dom_time: { $avg: '$dom_time' },
                        white_time: { $avg: '$white_time' },
                        request_time: { $avg: '$request_time' },
                        analysisDom_time: { $avg: '$analysisDom_time' },
                        ready_time: { $avg: '$ready_time' },
                    },
                },
                { $skip: (pageNo - 1) * pageSize },
                { $sort: { count: -1 } },
                { $limit: pageSize },
            ]).read('sp')
                .exec()
        );
        const all = await Promise.all([ count, datas ]);
        const [ totalNum, datalist ] = all;

        return {
            datalist,
            totalNum: totalNum.length,
            pageNo,
        };
    }

    // 单个页面性能数据列表
    async getOnePageList(ctx) {
        const query = ctx.request.query;
        const appId = query.appId;
        let type = query.type || 1;
        let pageNo = query.pageNo || 1;
        let pageSize = query.pageSize || this.app.config.pageSize;
        const beginTime = query.beginTime;
        const endTime = query.endTime;
        const url = query.url;

        pageNo = pageNo * 1;
        pageSize = pageSize * 1;
        type = type * 1;

        // 查询参数拼接
        const queryjson = { $match: {
            speed_type: type,
            url,
            create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) },
        } };

        const count = Promise.resolve(this.app.models.WebPages(appId).count(queryjson.$match).read('sp')
            .exec());
        const datas = Promise.resolve(
            this.app.models.WebPages(appId).aggregate([
                queryjson,
                { $sort: { create_time: -1 } },
                { $skip: ((pageNo - 1) * pageSize) },
                { $limit: pageSize },
            ]).read('sp')
                .exec()
        );
        const all = await Promise.all([ count, datas ]);
        const [ totalNum, datalist ] = all;

        return {
            datalist,
            totalNum,
            pageNo,
        };
    }

    // 单个页面详情
    async getPageDetails(appId, id) {
        return await this.app.models.WebPages(appId).findOne({ _id: id }).read('sp')
            .exec();
    }
}

module.exports = PagesService;
