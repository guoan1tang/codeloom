package com.acme.base.dal;

public class UserService {
    private UserMapper userMapper;

    public Object findById(Long id) {
        return userMapper.selectById(id);
    }

    public void save(UserEntity entity) {
        userMapper.insert(entity);
    }

    public Object list() {
        return PaginationUtils.queryAll(userMapper);
    }
}
