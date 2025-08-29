const axios = require('axios');

exports.login = async (req, res) => {
    const { auth, password, remember } = req.body;
    try {
        const response = await axios.post('https://joelgc.com/api/login', { auth, password, remember });
        req.session.user = response.data;
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Server error' });
    }
};
