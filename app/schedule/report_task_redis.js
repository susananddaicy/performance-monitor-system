'use strict';

// 处理数据定时任务
module.exports = app => {
    return {
        schedule: {
            cron: app.config.redis_consumption.task_time,
            type: 'worker',
            disable: !(app.config.report_data_type === 'redis'),
        },
        // 定时处理上报的数据 redis同步到db3数据
        async task(ctx) {
            if (app.config.is_web_task_run) {
                // 查询db3是否正常,不正常则重启
                try {
                    const result = await ctx.model.System.count({}).exec();
                    app.logger.info(`-----------db3--查询db3数据库是否可用---${result}------`);

                    if (app.config.is_web_task_run) ctx.service.web.reportTask.saveWebReportDatasForRedis();
                } catch (err) {
                    app.restartMongodbs('db3', ctx, err);
                }
            }
        },
    };
};
