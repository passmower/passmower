import Nodemailer from "nodemailer";

const transporter = Nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    ssl: process.env.EMAIL_SSL,
    auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD
    }
});

const mailOptions = {
    from: process.env.EMAIL_USERNAME,
};

class EmailAdapter {
    async sendMail(to, subject, textContent, htmlContent) {
        return await transporter.sendMail(
            {
                ...mailOptions,
                to,
                subject,
                text: textContent,
                html: htmlContent
            })
            .catch(e => console.error(e));
    }
}

export default EmailAdapter
