'use strict';
const crypto = require('crypto');
const Service = require('egg').Service;

/**
 * @class UserService
 * @extends {Service}
 */
class UserService extends Service {

    /* 用户登录
     * @param {*} userName
     * @param {*} passWord
     * @return
     * @memberof UserService
    */
    async login(userName, passWord) {
        const { isuse } = await this.app.config.ldap;
        let userInfo = await this.getUserInfoForUserName(userName) || {};
        if (isuse && !userInfo.token) {
            // 如果开启了ldap功能则去ldap查询用户是否存在，存在则注册
            await this.getUserInfoByIdap(userName, passWord);
            userInfo = await this.register(userName, passWord);
        } else if (!userInfo.token) {
            throw new Error('用户名不存在！');
        }
        const newPwd = crypto.createHmac('sha256', passWord)
            .update(this.app.config.user_pwd_salt_addition)
            .digest('hex');

        if (userInfo.pass_word !== newPwd) throw new Error('用户密码不正确！');
        if (userInfo.is_use !== 0) throw new Error('用户被冻结不能登录，请联系管理员！');

        // 清空以前的登录态
        if (userInfo.usertoken) this.app.redis.set(`${userInfo.usertoken}_user_login`, '');

        // 设置新的redis登录态
        const random_key = this.app.randomString();
        this.app.redis.set(`${random_key}_user_login`, JSON.stringify(userInfo), 'EX', this.app.config.user_login_timeout);
        // 设置登录cookie
        this.ctx.cookies.set('usertoken', random_key, {
            maxAge: this.app.config.user_login_timeout * 1000,
            httpOnly: true,
            encrypt: true,
            signed: true,
        });
        // 更新用户信息
        await this.updateUserToken({ username: userName, usertoken: random_key });

        return userInfo;
    }
    async getUserInfoByIdap(userName, passWord) {
        try {
            const result = await this.ctx.service.ldap.search(userName) || {};
            if (result.userPassword !== passWord) throw new Error('用户账号有误！');
            return result;
        } catch (err) {
            throw new Error('LAPD登录失败！');
        }
    }
    /* 登出
     * @param {*} usertoken
     * @returns
     * @memberof UserService
     */
    logout(usertoken) {
        this.ctx.cookies.set('usertoken', '');
        this.app.redis.set(`${usertoken}_user_login`, '');
        return {};
    }

    /* 用户注册
     * @param {*} userName
     * @param {*} passWord
     * @returns
     * @memberof UserService
     */
    async register(userName, passWord) {
        // 检测用户是否存在
        const userInfo = await this.getUserInfoForUserName(userName);
        if (userInfo.token) throw new Error('用户注册：用户已存在！');

        const newPwd = crypto.createHmac('sha256', passWord)
            .update(this.app.config.user_pwd_salt_addition)
            .digest('hex');

        // 新增用户
        const token = this.app.randomString();
        const user = this.ctx.model.User();
        user.user_name = userName;
        user.pass_word = newPwd;
        user.token = token;
        user.create_time = new Date();
        user.level = userName === 'admin' ? 0 : 1;
        user.usertoken = token;
        const result = await user.save() || {};
        result.pass_word = '';

        // 设置redis登录态
        this.app.redis.set(`${token}_user_login`, JSON.stringify(result), 'EX', this.app.config.user_login_timeout);
        // 设置登录cookie
        this.ctx.cookies.set('usertoken', token, {
            maxAge: this.app.config.user_login_timeout * 1000,
            httpOnly: true,
            encrypt: true,
            signed: true,
        });

        return result;
    }

    /* 根据用户名称查询用户信息
     * @param {*} userName
     * @returns
     * @memberof UserService
     */
    async getUserInfoForUserName(userName) {
        return await this.ctx.model.User.findOne({ user_name: userName }).exec() || {};
    }

    /* 查询用户列表信息（分页）
     * @param {*} pageNo
     * @param {*} pageSize
     * @param {*} userName
     * @returns
     * @memberof UserService
     */
    async getUserList(pageNo, pageSize, userName) {
        pageNo = pageNo * 1;
        pageSize = pageSize * 1;

        const query = {};
        if (userName) query.user_name = userName;

        const count = Promise.resolve(this.ctx.model.User.count(query).exec());
        const datas = Promise.resolve(
            this.ctx.model.User.find(query).skip((pageNo - 1) * pageSize)
                .limit(pageSize)
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

    /* 通过redis登录key获取用户信息
     * @param {*} usertoken
     * @returns
     * @memberof UserService
     */
    async getUserInfoForUsertoken(usertoken) {
        return this.app.redis.get(`${usertoken}_user_login`) || {};
    }

    /* 冻结解冻用户
     * @param {*} id
     * @param {*} isUse
     * @param {*} usertoken
     * @returns
     * @memberof UserService
     */
    async setIsUse(id, isUse, usertoken) {
        // 冻结用户信息
        isUse = isUse * 1;
        const result = await this.ctx.model.User.update(
            { _id: id },
            { is_use: isUse },
            { multi: true }
        ).exec();
        // 清空登录态
        this.app.redis.set(`${usertoken}_user_login`, '');
        return result;
    }

    /* 删除用户
     * @param {*} id
     * @param {*} usertoken
     * @returns
     * @memberof UserService
     */
    async delete(id, usertoken) {
        // 删除
        const result = await this.ctx.model.User.findOneAndRemove({ _id: id }).exec();
        // 清空登录态
        if (usertoken) this.app.redis.set(`${usertoken}_user_login`, '');
        return result;
    }

    /* 更新用户登录态随机数
     * @param {*} opt
     * @returns
     * @memberof UserService
     */
    async updateUserToken(opt) {
        const query = {};
        if (opt.username) {
            query.user_name = opt.username;
        } else if (opt.token) {
            query.token = opt.token;
        }
        const result = await this.ctx.model.User.update(
            query,
            { usertoken: opt.usertoken },
            { multi: true }
        ).exec();

        return result;
    }

    /* 根据token查询用户信息
     * @param {*} usertoken
     * @returns
     * @memberof UserService
     */
    async finUserForToken(usertoken) {
        let user_info = await this.app.redis.get(`${usertoken}_user_login`);

        if (user_info) {
            user_info = JSON.parse(user_info);
            if (user_info.is_use !== 0) return { desc: '用户被冻结不能登录，请联系管理员！' };
        } else {
            return null;
        }
        return await this.ctx.model.User.findOne({ token: user_info.token }).exec();
    }

}

module.exports = UserService;
